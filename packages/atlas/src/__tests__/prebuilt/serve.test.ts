import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { generateKeyPair } from '@/prebuilt';
import { buildSourcesServer } from '@/server/index';
import { resolveSources } from '@/sources';
import type { IResolvedSource } from '@/sources';
import {
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
} from '../sources/source-repo.helper';
import { startFakeGithub } from './fake-github.helper';
import type { IFakeGithub } from './fake-github.helper';
import { makePrebuiltSource, resigned, rowsOf } from './pair.helper';
import type { IFixturePair } from './pair.helper';

const SOURCE = { name: 'src', repo: 'acme/src', ref: 'develop' };

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let fake: IFakeGithub;
const touched = [
  'VULCAN_GITHUB_API_URL',
  'GITHUB_TOKEN',
  'VULCAN_NPM_REGISTRY',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
];

beforeEach(() => {
  fake = startFakeGithub({ owner: 'acme', repo: 'src' });
  process.env.VULCAN_GITHUB_API_URL = fake.apiUrl;
  process.env.GITHUB_TOKEN = 'test-token-value';
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(async () => {
  await fake.stop();

  for (const name of touched) {
    delete process.env[name];
  }
});

/** Git asks `https://github.com/acme/src.git`; this answers it from the local bare repository. */
const answerFrom = (opts: { bare: string }): void => {
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.file://${opts.bare}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/acme/src.git';
};

const putOnRelease = (opts: { pair: IFixturePair }): void => {
  fake.assets.set(`${opts.pair.sha}.atlas.json`, Buffer.from(opts.pair.envelope));
  fake.assets.set(`${opts.pair.sha}.atlas.gz`, opts.pair.gz);
};

const resolve = async (opts: {
  cwd?: string;
  cacheDir: string;
  prebuilt?: boolean;
  force?: boolean;
}) => {
  const [resolved] = await resolveSources({
    cwd: opts.cwd ?? makeTempDirectory({ prefix: 'atlas-consumer-' }),
    cacheDir: opts.cacheDir,
    sources: [SOURCE],
    prebuilt: opts.prebuilt,
    force: opts.force,
  });

  return resolved;
};

const newCache = (): string => makeTempDirectory({ prefix: 'atlas-cache-' });

const stderrLines = (opts: { spy: ReturnType<typeof spyOn> }): string[] =>
  opts.spy.mock.calls.map((call: unknown[]) => String(call[0]));

describe('a source with keys is served from its prebuilt index (C10, C17)', () => {
  test('the index is the downloaded one, and the declared paths are not checked out', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });

    const resolved = await resolve({ cacheDir: newCache() });

    expect(resolved.mode).toBe('fresh');
    expect(resolved.sha).toBe(source.pair.sha);
    expect(resolved.prebuiltBy).toBe('9.9.9');
    expect(rowsOf({ bytes: readFileSync(resolved.indexFile ?? '') })).toEqual(
      rowsOf({ bytes: gunzipSync(source.pair.gz) }),
    );
    expect(existsSync(join(resolved.root, '.agents/vulcan.manifest.json'))).toBe(true);
    expect(existsSync(join(resolved.root, 'docs/changelogs'))).toBe(false);
    expect(existsSync(join(resolved.root, 'packages'))).toBe(false);
    expect(JSON.parse(readFileSync(resolved.releasesFile ?? '', 'utf8'))).toEqual(
      source.pair.payload.releases,
    );
  });

  test('the second start comes from the cache and still says its index was prebuilt', async () => {
    const source = makePrebuiltSource();
    const cacheDir = newCache();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });
    await resolve({ cwd, cacheDir });

    const requests = fake.requests.length;
    const again = await resolve({ cwd, cacheDir });

    expect(again.mode).toBe('cache');
    expect(again.prebuiltBy).toBe('9.9.9');
    expect(fake.requests.length).toBe(requests);
  });

  test('the start notice names the prebuilt index', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });

    const resolved = await resolve({ cacheDir: newCache() });
    const result2 = await buildSourcesServer({
      sources: [resolved],
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      version: '0.0.0',
    }).handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const initialized = JSON.parse(result2 ?? 'null');

    expect(initialized.result.instructions).toContain('index: prebuilt, built by atlas 9.9.9');
  });

  test('the set on disk is a local set with one marker more (C17)', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });

    const downloaded = await resolve({ cacheDir: newCache() });
    const built = await resolve({ cacheDir: newCache(), prebuilt: false });
    const files = (opts: { resolved: IResolvedSource }) =>
      readdirSync(dirname(opts.resolved.indexFile ?? '')).sort();

    expect(files({ resolved: downloaded })).toEqual(
      [...files({ resolved: built }), 'prebuilt'].sort(),
    );

    for (const name of ['format', 'history', 'tags', 'releases.json']) {
      expect(readFileSync(join(dirname(downloaded.indexFile ?? ''), name), 'utf8')).toBe(
        readFileSync(join(dirname(built.indexFile ?? ''), name), 'utf8'),
      );
    }
  });
});

describe("the answers equal a local build's (C11)", () => {
  const call = async (opts: {
    transport: ReturnType<typeof buildSourcesServer>;
    name: string;
    args?: Record<string, unknown>;
  }) => {
    const result2 = await opts.transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: opts.name, arguments: opts.args ?? {} },
      }),
    });
    const reply = JSON.parse(result2 ?? 'null');

    return String(reply.result.content[0].text);
  };

  test('search, get, version and changes answer the same from a download and from a build', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });

    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const served = (opts: { resolved: IResolvedSource }) =>
      buildSourcesServer({ sources: [opts.resolved], cwd, version: '0.0.0' });
    const result = await resolve({ cwd, cacheDir: newCache() });
    const downloaded = served({ resolved: result });
    const result2 = await resolve({ cwd, cacheDir: newCache(), prebuilt: false });
    const built = served({
      resolved: result2,
    });
    const search = await call({
      transport: downloaded,
      name: 'search',
      args: { query: 'kernel boots' },
    });
    const id = String(JSON.parse(search).hits[0].id);

    expect(JSON.parse(search).total).toBeGreaterThan(0);

    const questions: [string, Record<string, unknown>][] = [
      ['search', { query: 'kernel boots' }],
      ['get', { id }],
      ['version', {}],
      ['changes', {}],
    ];

    for (const [name, args] of questions) {
      const downloadedAnswer = await call({ transport: downloaded, name, args });
      const builtAnswer = await call({ transport: built, name, args });

      expect(downloadedAnswer).toBe(builtAnswer);
    }
  });
});

describe('when the tags moved since the pair was built (C18)', () => {
  test('the release table is computed here, the index is still the downloaded one', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });
    git({ cwd: source.work, args: ['tag', 'kernel-v1.0.1'] });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'kernel-v1.0.1'] });

    const resolved = await resolve({ cacheDir: newCache() });
    const table = JSON.parse(readFileSync(resolved.releasesFile ?? '', 'utf8'));

    expect(resolved.prebuiltBy).toBe('9.9.9');
    expect(table.releases.kernel.map((release: { version: string }) => release.version)).toEqual([
      '1.0.1',
      '1.0.0',
    ]);
    expect(existsSync(join(resolved.root, 'docs/changelogs'))).toBe(true);
    expect(existsSync(join(resolved.root, 'packages'))).toBe(false);
  });
});

describe('a pair built from part of the history does not supply the release table', () => {
  test('the table is computed here, the index is still the downloaded one', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({
      pair: {
        ...source.pair,
        envelope: resigned({
          pair: source.pair,
          edit: (payload) => {
            payload.history = false;
          },
        }),
      },
    });

    const resolved = await resolve({ cacheDir: newCache() });

    expect(resolved.prebuiltBy).toBe('9.9.9');
    expect(existsSync(join(resolved.root, 'docs/changelogs'))).toBe(true);
  });
});

describe('every failure ends in a local build, with one line saying why (C12, C13, C20)', () => {
  const builtHere = async (opts: { cwd?: string }) => {
    const resolved = await resolve({ cwd: opts.cwd, cacheDir: newCache(), prebuilt: false });

    return rowsOf({ bytes: readFileSync(resolved.indexFile ?? '') });
  };

  test('a signature from an unlisted key', async () => {
    const source = makePrebuiltSource();
    const spy = spyOn(console, 'error').mockImplementation(() => undefined);

    answerFrom({ bare: source.bare });
    putOnRelease({
      pair: {
        ...source.pair,
        envelope: resigned({
          pair: { ...source.pair, keys: generateKeyPair() },
          edit: () => undefined,
        }),
      },
    });

    const resolved = await resolve({ cacheDir: newCache() });
    const lines = stderrLines({ spy }).filter((line) =>
      line.includes('the prebuilt index is not used'),
    );

    spy.mockRestore();
    expect(resolved.prebuiltBy).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('reason: signature');

    const builtRows = await builtHere({});

    expect(rowsOf({ bytes: readFileSync(resolved.indexFile ?? '') })).toEqual(builtRows);
  });

  test('a storage host that is down', async () => {
    const source = makePrebuiltSource();
    const spy = spyOn(console, 'error').mockImplementation(() => undefined);

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });
    await fake.stopStorage();

    const resolved = await resolve({ cacheDir: newCache() });
    const lines = stderrLines({ spy }).filter((line) =>
      line.includes('the prebuilt index is not used'),
    );

    spy.mockRestore();
    expect(resolved.mode).toBe('fresh');
    expect(resolved.prebuiltBy).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('reason: unreachable');

    const builtRows = await builtHere({});

    expect(rowsOf({ bytes: readFileSync(resolved.indexFile ?? '') })).toEqual(builtRows);
  });

  test('a commit with no pair on the release', async () => {
    const source = makePrebuiltSource();
    const spy = spyOn(console, 'error').mockImplementation(() => undefined);

    answerFrom({ bare: source.bare });

    const resolved = await resolve({ cacheDir: newCache() });

    expect(stderrLines({ spy }).filter((line) => line.includes('reason: no-pair'))).toHaveLength(1);
    spy.mockRestore();
    expect(resolved.prebuiltBy).toBeUndefined();
  });
});

describe('when nothing may be downloaded (C15, C19)', () => {
  test('a manifest with no keys makes no request', async () => {
    const source = makeSourceRepository();

    answerFrom({ bare: source.bare });
    await resolve({ cacheDir: newCache() });
    expect(fake.requests).toEqual([]);
  });

  test('prebuilt off makes no request, though the manifest lists keys and a pair exists', async () => {
    const source = makePrebuiltSource();

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });

    const resolved = await resolve({ cacheDir: newCache(), prebuilt: false });

    expect(fake.requests).toEqual([]);
    expect(resolved.prebuiltBy).toBeUndefined();
  });

  test('a forced pull downloads again; the cache does not stop it, and prebuilt is not skipped', async () => {
    const source = makePrebuiltSource();
    const cacheDir = newCache();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });

    answerFrom({ bare: source.bare });
    putOnRelease({ pair: source.pair });
    await resolve({ cwd, cacheDir });

    const before = fake.requests.length;
    const forced = await resolve({ cwd, cacheDir, force: true });

    expect(fake.requests.length).toBeGreaterThan(before);
    expect(forced.mode).toBe('fresh');
    expect(forced.prebuiltBy).toBe('9.9.9');
  });
});
