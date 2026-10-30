import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { attemptPrebuilt, fetchPrebuilt, generateKeyPair } from '@/prebuilt';
import type { IPrebuiltHit, IPrebuiltMiss } from '@/prebuilt';
import { TEMP_DIRECTORIES } from '../sources/source-repo.helper';
import { startFakeGithub } from './fake-github.helper';
import type { IFakeGithub } from './fake-github.helper';
import { makeFixturePair, resigned, withIndex } from './pair.helper';
import type { IFixturePair } from './pair.helper';

const GITHUB = { owner: 'acme', repo: 'src' };
const TOKEN = 'test-token-value';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let fixture: IFixturePair;
let fake: IFakeGithub;

beforeAll(() => {
  fixture = makeFixturePair();
});

beforeEach(() => {
  fake = startFakeGithub(GITHUB);
  process.env.VULCAN_GITHUB_API_URL = fake.apiUrl;
});

afterEach(async () => {
  await fake.stop();
  delete process.env.VULCAN_GITHUB_API_URL;
});

/** Put a pair on the fake's release, under the names of `sha`. */
const serve = (opts: { envelope: string; gz: Uint8Array; sha?: string }): void => {
  const sha = opts.sha ?? fixture.sha;

  fake.assets.set(`${sha}.atlas.json`, Buffer.from(opts.envelope));
  fake.assets.set(`${sha}.atlas.gz`, opts.gz);
};

const fetchFixture = (
  opts: {
    keys?: string[];
    sha?: string;
    limits?: Parameters<typeof fetchPrebuilt>[0]['limits'];
  } = {},
) =>
  fetchPrebuilt({
    github: GITHUB,
    sha: opts.sha ?? fixture.sha,
    keys: opts.keys ?? [fixture.keys.publicKey],
    token: TOKEN,
    limits: opts.limits,
  });

const missOf = (opts: { result: IPrebuiltHit | IPrebuiltMiss }): string =>
  opts.result.hit ? 'hit' : opts.result.reason;

describe('fetchPrebuilt: a verified pair is used (C10)', () => {
  test('the index in the pair comes back, and it is the one that was built', async () => {
    serve(fixture);

    const result = await fetchFixture();

    expect(result.hit).toBe(true);

    if (result.hit) {
      expect(result.index).toEqual(new Uint8Array(gunzipSync(fixture.gz)));
      expect(result.payload.sha).toBe(fixture.sha);
    }
  });

  test('a release with many assets is read page by page until the pair is found', async () => {
    for (let index = 0; index < 250; index += 1) {
      fake.assets.set(`${String(index).padStart(40, '0')}.atlas.gz`, new Uint8Array([1]));
    }

    serve(fixture);
    const result = await fetchFixture();
    expect(result.hit).toBe(true);
    expect(
      fake.requests.filter((request) => request.path.includes('/assets?')).length,
    ).toBeGreaterThan(1);
  });
});

describe('fetchPrebuilt: what the payload says must match what the reader holds (C12)', () => {
  test('a signature from a key that is not listed is a miss', async () => {
    serve(fixture);
    const result2 = await fetchFixture({ keys: [generateKeyPair().publicKey] });
    expect(missOf({ result: result2 })).toBe('signature');
  });

  test("a pair built for another commit, put under this commit's names, is a miss", async () => {
    const other = 'b'.repeat(40);

    serve({ ...fixture, sha: other });
    const result2 = await fetchFixture({ sha: other });
    expect(missOf({ result: result2 })).toBe('sha');
  });

  test('a pair built for another repository is a miss', async () => {
    serve({
      gz: fixture.gz,
      envelope: resigned({
        pair: fixture,
        edit: (payload) => {
          payload.repo = 'acme/other';
        },
      }),
    });
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('repo');
  });

  test('a pair of another format is a miss', async () => {
    serve({
      gz: fixture.gz,
      envelope: resigned({
        pair: fixture,
        edit: (payload) => {
          payload.format = 999;
        },
      }),
    });
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('format');
  });

  test('a gz that is not the one the payload digests is a miss', async () => {
    const changed = Uint8Array.from(fixture.gz);

    changed[changed.length - 12] ^= 0x01;
    serve({ envelope: fixture.envelope, gz: changed });
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('digest');
  });
});

describe('fetchPrebuilt: what is missing, slow, too large or the wrong size is a miss (C13)', () => {
  test('no envelope, and no gz, are misses that name the file', async () => {
    fake.assets.set(`${fixture.sha}.atlas.gz`, fixture.gz);

    const noEnvelope = await fetchFixture();

    expect(noEnvelope).toMatchObject({ hit: false, reason: 'no-pair' });
    expect(noEnvelope.hit ? '' : noEnvelope.detail).toContain('.atlas.json');
    fake.assets.clear();
    fake.assets.set(`${fixture.sha}.atlas.json`, Buffer.from(fixture.envelope));
    const result = await fetchFixture();
    expect(result).toMatchObject({ hit: false, reason: 'no-pair' });
  });

  test('no release at all is a miss', async () => {
    fake.options.release = false;
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('no-release');
  });

  test('a request that fails is a miss', async () => {
    serve(fixture);
    fake.options.assetStatus = 500;
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('unreachable');
  });

  test('a request that outlives its bound is a miss', async () => {
    serve(fixture);
    fake.options.hangStorage = true;

    const started = Date.now();
    const result = await fetchFixture({ limits: { timeoutMs: 500 } });

    expect(missOf({ result })).toBe('unreachable');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('a gz over its cap is a miss, and a payload that announces too large an index is a miss', async () => {
    serve(fixture);
    const result2 = await fetchFixture({ limits: { gzBytes: 100 } });
    expect(missOf({ result: result2 })).toBe('too-large');
    const result3 = await fetchFixture({ limits: { indexBytes: 100 } });
    expect(missOf({ result: result3 })).toBe('too-large');
  });

  test('an index that decompresses to more or to less than the payload says is a miss', async () => {
    const real = new Uint8Array(gunzipSync(fixture.gz));

    serve({
      ...withIndex({
        pair: fixture,
        index: real,
        edit: (payload) => {
          payload.bytes = real.length - 1;
        },
      }),
    });
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('size');
    serve({
      ...withIndex({
        pair: fixture,
        index: real,
        edit: (payload) => {
          payload.bytes = real.length + 10;
        },
      }),
    });
    const result3 = await fetchFixture();
    expect(missOf({ result: result3 })).toBe('size');
  });
});

describe('fetchPrebuilt: a pair that verifies but cannot be opened is not promoted (C14)', () => {
  test('bytes that are not a database are a miss', async () => {
    serve(
      withIndex({
        pair: fixture,
        index: new TextEncoder().encode('this is not an sqlite file '.repeat(200)),
      }),
    );
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('unreadable');
  });

  test('a database with no chunks table is a miss', async () => {
    const database = new Database(':memory:');

    database.run('CREATE TABLE other (x TEXT)');
    serve(withIndex({ pair: fixture, index: database.serialize() }));
    database.close();
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('unreadable');
  });
});

describe('the token goes to the API host and nowhere else (C16)', () => {
  test('the API requests carry it, the storage host the API redirects to does not', async () => {
    serve(fixture);
    await fetchFixture();

    const api = fake.requests.filter((request) => request.server === 'api');
    const storage = fake.requests.filter((request) => request.server === 'storage');

    expect(api.length).toBeGreaterThan(2);
    expect(api.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(storage.length).toBe(2);
    expect(storage.every((request) => request.authorization === null)).toBe(true);
  });

  test('an asset URL on another host is a miss, and that host is never asked', async () => {
    serve(fixture);
    fake.options.foreignAssetUrls = true;
    const result2 = await fetchFixture();
    expect(missOf({ result: result2 })).toBe('foreign-url');
    expect(fake.requests.filter((request) => request.server === 'storage')).toEqual([]);
  });
});

describe('attemptPrebuilt asks the network only when it may (C15)', () => {
  const source = { name: 'src', repo: 'acme/src', ref: 'develop' };

  test.each([
    ['the manifest lists no keys', { enabled: true, keys: [], repo: 'acme/src' }],
    ['the download is off', { enabled: false, keys: ['k'], repo: 'acme/src' }],
    [
      'the source is a git URL',
      { enabled: true, keys: ['k'], repo: 'https://example.com/acme/src.git' },
    ],
  ])('%s: no request is made', async (_label, input) => {
    serve(fixture);
    process.env.GITHUB_TOKEN = TOKEN;

    const result = await attemptPrebuilt({
      enabled: input.enabled,
      source: { ...source, repo: input.repo },
      sha: fixture.sha,
      keys: input.keys,
    });

    delete process.env.GITHUB_TOKEN;
    expect(result).toBeUndefined();
    expect(fake.requests).toEqual([]);
  });
});
