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
 * A package a tool was asked about, as a directory: through the table's package map, case-blind;
 * a name the map does not know is taken as a bare directory name.
 */
export const directoryOfQuery = (opts: {
  value: string;
  packageMap: IPackageMapEntry[];
}): string => {
  const wanted = opts.value.trim().toLowerCase();
  const packages = opts.packageMap.map(entry => ({
    dir: entry.dir,
    name: entry.name.toLowerCase(),
    aliases: entry.aliases.map(alias => alias.toLowerCase()),
  }));

  return directoryOf({ value: wanted, packages }) ?? wanted;
};
