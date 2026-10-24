import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cacheBaseOf, cacheRootOf, DEFAULT_CACHE_DIRECTORY, resolveSources } from '@/sources';
import {
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const SAVED = {
  home: process.env.HOME,
  cache: process.env.XDG_CACHE_HOME,
  config: process.env.XDG_CONFIG_HOME,
};

const restore = (opts: { name: string; value: string | undefined }): void => {
  if (opts.value === undefined) {
    delete process.env[opts.name];
  } else {
    process.env[opts.name] = opts.value;
  }
};

let fakeHome: string;

beforeEach(() => {
  fakeHome = makeTempDirectory({ prefix: 'atlas-fake-home-' });
  process.env.HOME = fakeHome;
  process.env.XDG_CACHE_HOME = join(fakeHome, '.cache');
  process.env.XDG_CONFIG_HOME = join(fakeHome, '.config');
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  restore({ name: 'HOME', value: SAVED.home });
  restore({ name: 'XDG_CACHE_HOME', value: SAVED.cache });
  restore({ name: 'XDG_CONFIG_HOME', value: SAVED.config });
  delete process.env.VULCAN_NPM_REGISTRY;
});

describe('cacheBaseOf', () => {
  test('defaults to .agents/local/cache under the working directory', () => {
    expect(DEFAULT_CACHE_DIRECTORY).toBe('.agents/local/cache');
    expect(cacheBaseOf({ cwd: '/work/app' })).toBe('/work/app/.agents/local/cache');
  });

  test('a relative cache directory is taken from the working directory, an absolute one as given', () => {
    expect(cacheBaseOf({ cwd: '/work/app', cacheDir: 'build/atlas' })).toBe(
      '/work/app/build/atlas',
    );
    expect(cacheBaseOf({ cwd: '/work/app', cacheDir: '/data/atlas' })).toBe('/data/atlas');
  });

  test('a repository root sits under atlas/v1 of the base', () => {
    const root = cacheRootOf({ repo: 'VENIZIA-AI/ignis', cacheBase: '/b' });

    expect(root).toBe(resolve('/b', 'atlas/v1/github.com/VENIZIA-AI/ignis'));
  });
});

describe('atlas writes nothing outside the project', () => {
  test('a pull lands in the working directory, and a home and config folder stay empty', async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const [resolved] = await resolveSources({
      cwd,
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    expect(resolved?.root.startsWith(join(cwd, '.agents/local/cache'))).toBe(true);
    expect(existsSync(join(cwd, '.agents/local/cache/atlas/v1'))).toBe(true);
    expect(readdirSync(fakeHome)).toEqual([]);
  }, 60_000);

  test('--cache-dir moves the cache and the default location stays unused', async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const cacheDir = makeTempDirectory({ prefix: 'atlas-chosen-cache-' });

    await resolveSources({
      cwd,
      cacheDir,
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    expect(existsSync(join(cacheDir, 'atlas/v1'))).toBe(true);
    expect(existsSync(join(cwd, '.agents/local/cache'))).toBe(false);
    expect(readdirSync(fakeHome)).toEqual([]);
  }, 60_000);
});
