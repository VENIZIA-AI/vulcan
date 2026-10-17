import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtlasTimeouts } from '@/common/constants';
import { readPackageDirectory } from '@/common/package-entries';
import type { IAtlasProject } from '@/common/project-config';
import type { ISymbolRecord } from './common';
import { AtlasSymbols } from './generator';

/** The cache layout this atlas reads and writes (V2); a cache from another layout is never read. */
const SYMBOLS_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

interface ISymbolsCache {
  schemaVersion: number;
  name: string;
  version: string;
  symbols: ISymbolRecord[];
}

/** `$XDG_CACHE_HOME/vulcan/atlas/v1/symbols` - a published version never changes, so it never expires. */
export const symbolsCacheDirectory = (): string =>
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'vulcan', 'atlas', 'v1', 'symbols');

const cacheFileOf = (opts: { name: string; version: string }): string =>
  join(symbolsCacheDirectory(), `${opts.name.replace('/', '__')}@${opts.version}.json`);

/** The cached symbols of `name@version`, or `undefined` when no pull or install has read them yet. */
export const cachedSymbols = (opts: {
  name: string;
  version: string;
}): ISymbolRecord[] | undefined => {
  const file = cacheFileOf(opts);

  if (!existsSync(file)) {
    return undefined;
  }

  const cache: ISymbolsCache = JSON.parse(readFileSync(file, 'utf8'));

  return cache.schemaVersion === SYMBOLS_SCHEMA_VERSION ? cache.symbols : undefined;
};

const writeCache = (opts: { name: string; version: string; symbols: ISymbolRecord[] }): void => {
  const file = cacheFileOf(opts);
  const cache: ISymbolsCache = { schemaVersion: SYMBOLS_SCHEMA_VERSION, ...opts };

  mkdirSync(symbolsCacheDirectory(), { recursive: true });
  // Written whole, then moved into place: a reader never sees half a file.
  writeFileSync(`${file}.partial`, JSON.stringify(cache));
  renameSync(`${file}.partial`, file);
};

/**
 * Project Contract v1, D2: the symbols of an installed package, read from its own declaration files -
 * the exact version the consumer runs, with no network. Cached by `name@version`.
 */
export const symbolsOfInstalled = (opts: { directory: string }): ISymbolRecord[] => {
  const { name, version }: { name: string; version: string } = JSON.parse(
    readFileSync(join(opts.directory, 'package.json'), 'utf8'),
  );
  const cached = cachedSymbols({ name, version });

  if (cached !== undefined) {
    return cached;
  }

  const symbols = AtlasSymbols.recordsOf({
    repoRoot: opts.directory,
    packages: [readPackageDirectory({ directory: opts.directory })],
  });

  writeCache({ name, version, symbols });

  return symbols;
};

/**
 * The symbols of a version nobody installed here: its npm tarball, fetched once, unpacked, read and
 * cached by `name@version`. `VULCAN_NPM_REGISTRY` points at another registry.
 */
export const symbolsOfPublished = async (opts: {
  name: string;
  version: string;
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

  const work = mkdtempSync(join(tmpdir(), 'atlas-tarball-'));

  try {
    const tarball = join(work, 'package.tgz');

    writeFileSync(tarball, new Uint8Array(await response.arrayBuffer()));

    const unpacked = spawnSync('tar', ['-xzf', tarball, '-C', work], { encoding: 'utf8' });

    if (unpacked.status !== 0) {
      throw new Error(`atlas: could not unpack ${opts.name}@${opts.version}: ${unpacked.stderr}`);
    }

    return symbolsOfInstalled({ directory: join(work, 'package') });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/** Repo mode: the project's own live packages, read from their built declarations - never cached. */
export const symbolsOfRepository = (opts: { project: IAtlasProject }): ISymbolRecord[] => {
  const packages = opts.project.packages
    .filter(
      entry => !entry.retired && existsSync(join(opts.project.root, entry.path, 'package.json')),
    )
    .map(entry =>
      readPackageDirectory({ directory: join(opts.project.root, entry.path), name: entry.dir }),
    );

  return packages.length === 0
    ? []
    : AtlasSymbols.recordsOf({ repoRoot: opts.project.root, packages });
};
