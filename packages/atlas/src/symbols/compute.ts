import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { AtlasTimeouts } from '@/common/constants';
import { readPackageDirectory } from '@/common/package-entries';
import { isNpmPackageName } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import type { ISymbolRecord } from './common';
import { AtlasSymbols } from './generator';

/** The cache layout this atlas reads and writes (V2); a cache from another layout is never read. */
const SYMBOLS_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
/** The characters a semver version is spelled with - never a `/`. */
const CACHEABLE_VERSION = /^[0-9A-Za-z.+-]+$/;

interface ISymbolsCache {
  schemaVersion: number;
  name: string;
  version: string;
  symbols: ISymbolRecord[];
}

/** `<cacheBase>/atlas/v1/symbols` - a published version never changes, so it never expires. */
export const symbolsCacheDirectory = (opts: { cacheBase: string }): string =>
  join(opts.cacheBase, 'atlas', 'v1', 'symbols');

/**
 * `@scope+name@version.json`: `+` is in no npm name, so two names never share a file. A name or a
 * version read from a fetched source is checked first - neither may carry a path out of the cache.
 */
const cacheFileOf = (opts: { name: string; version: string; cacheBase: string }): string => {
  if (!isNpmPackageName({ name: opts.name })) {
    throw new Error(`atlas: '${opts.name}' is not an npm package name`);
  }

  if (!CACHEABLE_VERSION.test(opts.version)) {
    throw new Error(`atlas: '${opts.version}' is not a version`);
  }

  return join(symbolsCacheDirectory(opts), `${opts.name.replace('/', '+')}@${opts.version}.json`);
};

/** The cached symbols of `name@version`, or `undefined` when no pull or install has read them yet. */
export const cachedSymbols = (opts: {
  name: string;
  version: string;
  cacheBase: string;
}): ISymbolRecord[] | undefined => {
  const file = cacheFileOf(opts);

  if (!existsSync(file)) {
    return undefined;
  }

  const cache: ISymbolsCache = JSON.parse(readFileSync(file, 'utf8'));

  return cache.schemaVersion === SYMBOLS_SCHEMA_VERSION ? cache.symbols : undefined;
};

const writeCache = (opts: {
  name: string;
  version: string;
  symbols: ISymbolRecord[];
  cacheBase: string;
}): void => {
  const file = cacheFileOf(opts);
  const { name, version, symbols } = opts;
  const cache: ISymbolsCache = { schemaVersion: SYMBOLS_SCHEMA_VERSION, name, version, symbols };

  mkdirSync(symbolsCacheDirectory(opts), { recursive: true });
  // Written whole, then moved into place: a reader never sees half a file.
  writeFileSync(`${file}.partial`, JSON.stringify(cache));
  renameSync(`${file}.partial`, file);
};

/**
 * Project Contract v1, D2: the symbols of an installed package, read from its own declaration files -
 * the exact version the consumer runs, with no network. Cached by `name@version`.
 */
export const symbolsOfInstalled = (opts: {
  directory: string;
  cacheBase: string;
}): ISymbolRecord[] => {
  const { name, version }: { name: string; version: string } = JSON.parse(
    readFileSync(join(opts.directory, 'package.json'), 'utf8'),
  );
  const cached = cachedSymbols({ name, version, cacheBase: opts.cacheBase });

  if (cached !== undefined) {
    return cached;
  }

  const symbols = AtlasSymbols.recordsOf({
    repoRoot: opts.directory,
    packages: [readPackageDirectory({ directory: opts.directory })],
  });

  writeCache({ name, version, symbols, cacheBase: opts.cacheBase });

  return symbols;
};

/**
 * The symbols of a version nobody installed here: its npm tarball, fetched once, unpacked, read and
 * cached by `name@version`. `VULCAN_NPM_REGISTRY` points at another registry.
 */
export const symbolsOfPublished = async (opts: {
  name: string;
  version: string;
  cacheBase: string;
}): Promise<ISymbolRecord[]> => {
  const cached = cachedSymbols(opts);

  if (cached !== undefined) {
    return cached;
  }

  const registry = (process.env.VULCAN_NPM_REGISTRY ?? DEFAULT_REGISTRY).replace(/\/+$/, '');
  const base = opts.name.split('/').pop() ?? opts.name;
  const response = await fetch(`${registry}/${opts.name}/-/${base}-${opts.version}.tgz`, {
    signal: AbortSignal.timeout(AtlasTimeouts.DOWNLOAD_MS),
  });

  if (!response.ok) {
    throw new Error(`atlas: no npm tarball for ${opts.name}@${opts.version} (${response.status})`);
  }

  const scratch = join(opts.cacheBase, 'tmp');

  mkdirSync(scratch, { recursive: true });

  const work = mkdtempSync(join(scratch, 'atlas-tarball-'));

  try {
    const tarball = join(work, 'package.tgz');

    writeFileSync(tarball, new Uint8Array(await response.arrayBuffer()));

    const unpacked = spawnSync('tar', ['-xzf', tarball, '-C', work], { encoding: 'utf8' });

    if (unpacked.status !== 0) {
      throw new Error(`atlas: could not unpack ${opts.name}@${opts.version}: ${unpacked.stderr}`);
    }

    return symbolsOfInstalled({ directory: join(work, 'package'), cacheBase: opts.cacheBase });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

const DECLARATIONS = new Bun.Glob('**/*.d.{ts,mts,cts}');

/**
 * Repo mode's dist fingerprint (D2): how many declaration files the live packages hold, the newest
 * mtime and the total size. A rebuild moves it - a changed signature changes the size or the mtime -
 * so the symbol store reads the declarations again instead of serving the last build until a restart.
 */
export const declarationsFingerprintOf = (opts: { project: IAtlasProject }): string => {
  let count = 0;
  let newestMtimeMs = 0;
  let totalBytes = 0;

  for (const entry of opts.project.packages.filter((item) => !item.retired)) {
    const directory = join(opts.project.root, entry.path);

    if (!existsSync(directory)) {
      continue;
    }

    for (const relativePath of DECLARATIONS.scanSync({ cwd: directory })) {
      if (relativePath.split('/').includes('node_modules')) {
        continue;
      }

      const { mtimeMs, size } = statSync(join(directory, relativePath));

      count += 1;
      newestMtimeMs = Math.max(newestMtimeMs, mtimeMs);
      totalBytes += size;
    }
  }

  return `${count}:${newestMtimeMs}:${totalBytes}`;
};

/** Repo mode: the project's own live packages, read from their built declarations - never cached. */
export const symbolsOfRepository = (opts: { project: IAtlasProject }): ISymbolRecord[] => {
  const packages = opts.project.packages
    .filter(
      (entry) => !entry.retired && existsSync(join(opts.project.root, entry.path, 'package.json')),
    )
    .map((entry) =>
      readPackageDirectory({ directory: join(opts.project.root, entry.path), name: entry.dir }),
    );

  return packages.length === 0
    ? []
    : AtlasSymbols.recordsOf({ repoRoot: opts.project.root, packages });
};
