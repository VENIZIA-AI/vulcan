import { RpcError, RpcErrorCodes } from '@/protocol/common';

/** One package as the generated tables record it: its directory, its npm name, its other names. */
export interface IPackageMapEntry {
  dir: string;
  name: string;
  aliases: string[];
}

const unscopedOf = (opts: { name: string }): string => opts.name.replace(/^@[^/]+\//, '');

/**
 * The directory a value names, or `undefined`: by npm name, by that name without its scope, or by
 * directory first, then by alias. Backticks and surrounding space are ignored; the match is exact,
 * so a table cell of prose never resolves to a package by accident.
 */
export const directoryOf = (opts: {
  value: string;
  packages: IPackageMapEntry[];
}): string | undefined => {
  const cleaned = opts.value.replace(/`/g, '').trim();
  const named = opts.packages.find(
    entry =>
      entry.name === cleaned ||
      unscopedOf({ name: entry.name }) === cleaned ||
      entry.dir === cleaned,
  );

  return named?.dir ?? opts.packages.find(entry => entry.aliases.includes(cleaned))?.dir;
};

/**
 * A package a tool was asked about, as its npm name - the identity every result carries (Project
 * Contract v1, C2): by npm name, by that name without its scope, by directory or by alias,
 * case-blind. A value the map does not know comes back as given, trimmed.
 */
export const packageOfQuery = (opts: { value: string; packageMap: IPackageMapEntry[] }): string => {
  const wanted = opts.value.trim();
  const lowered = opts.packageMap.map(entry => ({
    dir: entry.dir,
    name: entry.name.toLowerCase(),
    aliases: entry.aliases.map(alias => alias.toLowerCase()),
  }));
  const dir = directoryOf({ value: wanted.toLowerCase(), packages: lowered });

  return opts.packageMap.find(entry => entry.dir === dir)?.name ?? wanted;
};

/** A table key (a directory) as its npm name; a table without a map keeps its keys. */
export const packageOfDirectory = (opts: { dir: string; packageMap: IPackageMapEntry[] }): string =>
  opts.packageMap.find(entry => entry.dir === opts.dir)?.name ?? opts.dir;

/**
 * A package asked about across every source atlas serves: the one source that knows it, with its
 * npm name. A directory or an alias two sources share is ambiguous - the error lists the npm names,
 * which never collide.
 */
export const packageAcrossSources = (opts: {
  value: string;
  sources: { source: string; packageMap: IPackageMapEntry[] }[];
}): { source: string; name: string } | undefined => {
  const matches = opts.sources.flatMap(({ source, packageMap }) => {
    const name = packageOfQuery({ value: opts.value, packageMap });

    return packageMap.some(entry => entry.name === name) ? [{ source, name }] : [];
  });

  if (matches.length > 1) {
    throw new RpcError({
      code: RpcErrorCodes.INVALID_PARAMS,
      message: `'${opts.value}' names a package in more than one source - ask by npm name: ${matches
        .map(match => `${match.name} (${match.source})`)
        .join(', ')}`,
    });
  }

  return matches[0];
};
