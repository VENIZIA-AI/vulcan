import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, toAtlasProject } from '@/common/project-config';
import {
  decidePrune,
  fetchPrebuilt,
  generateKeyPair,
  publishGuard,
  publishIndex,
  verifyPair,
} from '@/prebuilt';
import type { IAssetInfo } from '@/prebuilt';
import { computeReleases } from '@/releases/compute';
import {
  git,
  makeSourceRepository,
  makeTempDirectory,
  TEMP_DIRECTORIES,
} from '../sources/source-repo.helper';
import { startFakeGithub } from './fake-github.helper';
import type { IFakeGithub } from './fake-github.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const SHA = (opts: { n: number }): string => opts.n.toString(16).padStart(40, '0');

describe('the guard: only a push to a protected ref publishes (C24)', () => {
  const event = join(makeTempDirectory({ prefix: 'atlas-event-' }), 'event.json');

  writeFileSync(event, '{"repository":{"default_branch":"main"}}');

  const env = (
    changes: Record<string, string | undefined> = {},
  ): Record<string, string | undefined> => ({
    GITHUB_EVENT_NAME: 'push',
    GITHUB_EVENT_PATH: event,
    GITHUB_REF: 'refs/heads/develop',
    GITHUB_SHA: SHA({ n: 1 }),
    GITHUB_REPOSITORY: 'acme/src',
    GITHUB_TOKEN: 'token',
    ATLAS_INDEX_KEY: 'key',
    ...changes,
  });
  const guard = (opts: { env: Record<string, string | undefined>; onBranch?: () => boolean }) =>
    publishGuard({ root: '.', env: opts.env, keyEnv: 'ATLAS_INDEX_KEY', onBranch: opts.onBranch });

  test.each([
    [
      'a manual run on develop',
      { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/develop' },
    ],
    ['a push to develop', { GITHUB_REF: 'refs/heads/develop' }],
    ['a push to the default branch the event names', { GITHUB_REF: 'refs/heads/main' }],
  ])('%s publishes', (_label, changes) => {
    expect(guard({ env: env(changes) })).toEqual({ publish: true });
  });

  test.each([
    [
      'a pull request',
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/4/merge' },
      'pull_request',
    ],
    ['a scheduled run', { GITHUB_EVENT_NAME: 'schedule' }, 'schedule'],
    ['an issue event', { GITHUB_EVENT_NAME: 'issues' }, 'issues'],
    ['an empty key', { ATLAS_INDEX_KEY: '' }, 'ATLAS_INDEX_KEY is empty'],
    ['a missing key', { ATLAS_INDEX_KEY: undefined }, 'ATLAS_INDEX_KEY is empty'],
    ['no token', { GITHUB_TOKEN: undefined }, 'GITHUB_TOKEN'],
    ['a feature branch', { GITHUB_REF: 'refs/heads/feat/x' }, 'not the default branch'],
    [
      'the tag of the release that holds the pairs',
      { GITHUB_REF: 'refs/tags/atlas-index' },
      'holds the pairs',
    ],
    ['a ref that is neither', { GITHUB_REF: 'refs/pull/4/head' }, 'not a branch or a tag'],
  ])('%s publishes nothing', (_label, changes, reason) => {
    const result = guard({ env: env(changes) });

    expect(result.publish).toBe(false);
    expect(result.publish ? '' : result.reason).toContain(reason);
  });

  test('a tag publishes when its commit is on a protected branch, and not when it is on none', () => {
    const tagged = env({ GITHUB_REF: 'refs/tags/kernel-v1.0.0' });

    expect(guard({ env: tagged, onBranch: () => true })).toEqual({ publish: true });
    expect(guard({ env: tagged, onBranch: () => false }).publish).toBe(false);
  });

  test('a tag is checked against develop and the default branch, nothing else', () => {
    const asked: string[] = [];

    guard({
      env: env({ GITHUB_REF: 'refs/tags/kernel-v1.0.0' }),
      onBranch: () => {
        asked.push('x');

        return false;
      },
    });
    expect(asked).toHaveLength(2);
  });

  test('with no readable event the default branch is unknown, and only develop publishes', () => {
    const blind = { GITHUB_EVENT_PATH: join(event, 'missing') };

    expect(guard({ env: env({ ...blind, GITHUB_REF: 'refs/heads/main' }) }).publish).toBe(false);
    expect(guard({ env: env({ ...blind, GITHUB_REF: 'refs/heads/develop' }) }).publish).toBe(true);
  });
});

describe('what pruning removes (C22)', () => {
  const asset = (opts: { n: number; kind: 'gz' | 'json'; minute: number }): IAssetInfo => ({
    id: opts.n * 10 + (opts.kind === 'gz' ? 1 : 2),
    name: `${SHA({ n: opts.n })}.atlas.${opts.kind}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, opts.minute)).toISOString(),
  });
  const pair = (opts: { n: number; minute: number }): IAssetInfo[] => [
    asset({ ...opts, kind: 'gz' }),
    asset({ ...opts, kind: 'json' }),
  ];
  const names = (opts: { removed: IAssetInfo[] }): string[] =>
    opts.removed.map((entry) => entry.name).sort();
  const NOW = Date.UTC(2026, 0, 3);

  test('the newest heads are kept, the older ones go, and every release-tag pair stays', () => {
    const heads = Array.from({ length: 6 }, (_, index) =>
      pair({ n: index + 1, minute: index + 10 }),
    ).flat();
    const tags = [pair({ n: 50, minute: 1 }), pair({ n: 51, minute: 2 })].flat();
    const result = decidePrune({
      assets: [...heads, ...tags],
      tagShas: new Set([SHA({ n: 50 }), SHA({ n: 51 })]),
      protect: SHA({ n: 6 }),
      now: NOW,
      keepHeads: 4,
    });

    expect(names({ removed: result.remove })).toEqual(
      [1, 2].flatMap((n) => [`${SHA({ n })}.atlas.gz`, `${SHA({ n })}.atlas.json`]).sort(),
    );
    expect(result.kept).toBe(6);
  });

  test('a commit that is a head and a tag is a tag: it is not counted among the heads', () => {
    const assets = [
      ...pair({ n: 1, minute: 1 }),
      ...pair({ n: 2, minute: 2 }),
      ...pair({ n: 3, minute: 3 }),
    ];
    const result = decidePrune({
      assets,
      tagShas: new Set([SHA({ n: 1 })]),
      protect: SHA({ n: 3 }),
      now: NOW,
      keepHeads: 1,
    });

    expect(names({ removed: result.remove })).toEqual([
      `${SHA({ n: 2 })}.atlas.gz`,
      `${SHA({ n: 2 })}.atlas.json`,
    ]);
  });

  test('past the total, the oldest tag pairs go first, and the pair being published never does', () => {
    const tags = Array.from({ length: 8 }, (_, index) =>
      pair({ n: index + 1, minute: index + 1 }),
    ).flat();
    const result = decidePrune({
      assets: tags,
      tagShas: new Set(Array.from({ length: 8 }, (_, index) => SHA({ n: index + 1 }))),
      protect: SHA({ n: 1 }),
      now: NOW,
      maxPairs: 5,
    });

    // 3 over the total: the three oldest tag pairs, but the oldest of all is the one being published.
    expect(names({ removed: result.remove })).toEqual(
      [2, 3, 4].flatMap((n) => [`${SHA({ n })}.atlas.gz`, `${SHA({ n })}.atlas.json`]).sort(),
    );
    expect(result.kept).toBe(5);
  });

  test('a pair with a member missing is left for a day, then removed; a file that is not a pair is never touched', () => {
    const stray: IAssetInfo = {
      id: 999,
      name: 'notes.txt',
      createdAt: new Date(Date.UTC(2020, 0, 1)).toISOString(),
    };
    const orphanOld: IAssetInfo = {
      ...asset({ n: 7, kind: 'gz', minute: 0 }),
      createdAt: new Date(NOW - 25 * 3_600_000).toISOString(),
    };
    const orphanNew: IAssetInfo = {
      ...asset({ n: 8, kind: 'gz', minute: 0 }),
      createdAt: new Date(NOW - 3_600_000).toISOString(),
    };
    const result = decidePrune({
      assets: [stray, orphanOld, orphanNew],
      tagShas: new Set(),
      protect: SHA({ n: 99 }),
      now: NOW,
    });

    expect(names({ removed: result.remove })).toEqual([orphanOld.name]);
  });

  test('the defaults are 20 heads and 300 pairs', () => {
    const heads = Array.from({ length: 25 }, (_, index) =>
      pair({ n: index + 1, minute: index + 1 }),
    ).flat();
    const result = decidePrune({
      assets: heads,
      tagShas: new Set(),
      protect: SHA({ n: 25 }),
      now: NOW,
    });

    expect(result.remove).toHaveLength(10);
    expect(result.kept).toBe(20);
  });
});

describe('publishing a pair (C21, C23)', () => {
  let fake: IFakeGithub;
  let work: string;
  let bare: string;
  let env: Record<string, string | undefined>;
  const keys = generateKeyPair();
  const event = join(makeTempDirectory({ prefix: 'atlas-event-' }), 'event.json');

  writeFileSync(event, '{"repository":{"default_branch":"main"}}');

  beforeEach(() => {
    fake = startFakeGithub({ owner: 'acme', repo: 'src' });
    fake.options.release = false;

    const source = makeSourceRepository();

    work = source.work;
    bare = source.bare;
    env = {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: event,
      GITHUB_REF: 'refs/heads/develop',
      GITHUB_SHA: git({ cwd: work, args: ['rev-parse', 'HEAD'] }),
      GITHUB_REPOSITORY: 'acme/src',
      GITHUB_TOKEN: 'test-token-value',
      GITHUB_API_URL: fake.apiUrl,
      ATLAS_INDEX_KEY: keys.privateKey,
    };
  });

  afterEach(async () => {
    await fake.stop();
  });

  const publish = () =>
    publishIndex({ root: work, env, keyEnv: 'ATLAS_INDEX_KEY', atlasVersion: '9.9.9' });

  test('the release is made once, as a pre-release that is not latest, and the pair is on it', async () => {
    const result = await publish();
    const sha = env.GITHUB_SHA ?? '';

    expect(result).toMatchObject({
      published: true,
      sha,
      uploaded: [`${sha}.atlas.gz`, `${sha}.atlas.json`],
    });
    expect(fake.releasesCreated).toHaveLength(1);
    expect(fake.releasesCreated[0]['tag_name']).toBe('atlas-index');
    expect(fake.releasesCreated[0]['prerelease']).toBe(true);
    expect(fake.releasesCreated[0]['make_latest']).toBe('false');
    expect([...fake.assets.keys()].sort()).toEqual([`${sha}.atlas.gz`, `${sha}.atlas.json`]);

    await publish();
    expect(fake.releasesCreated).toHaveLength(1);
  });

  test('what it uploaded verifies with the public key, and a reader takes it', async () => {
    await publish();

    const sha = env.GITHUB_SHA ?? '';
    const checked = verifyPair({
      envelope: Buffer.from(fake.assets.get(`${sha}.atlas.json`) ?? '').toString('utf8'),
      gz: fake.assets.get(`${sha}.atlas.gz`) ?? new Uint8Array(),
      keys: [keys.publicKey],
    });

    expect(checked.ok).toBe(true);

    process.env.VULCAN_GITHUB_API_URL = fake.apiUrl;

    const read = await fetchPrebuilt({
      github: { owner: 'acme', repo: 'src' },
      sha,
      keys: [keys.publicKey],
      token: 'x',
    });

    delete process.env.VULCAN_GITHUB_API_URL;
    expect(read.hit).toBe(true);
  });

  test('the gz goes up before the envelope that names it', async () => {
    await publish();

    const uploads = fake.requests.filter(
      (request) => request.method === 'POST' && request.path.includes('/assets?name='),
    );

    expect(uploads.map((request) => request.path.split('name=')[1].split('.atlas.')[1])).toEqual([
      'gz',
      'json',
    ]);
  });

  test('a commit published twice has its old pair removed before the new one goes up', async () => {
    await publish();

    const before = fake.requests.length;

    await publish();

    const second = fake.requests.slice(before);
    const firstDelete = second.findIndex((request) => request.method === 'DELETE');
    const firstUpload = second.findIndex((request) => request.method === 'POST');

    expect(firstDelete).toBeGreaterThan(-1);
    expect(firstDelete).toBeLessThan(firstUpload);
    expect([...fake.assets.keys()]).toHaveLength(2);
  });

  test('every request goes to the API host with the token, and none to the storage host', async () => {
    await publish();
    expect(fake.requests.every((request) => request.server === 'api')).toBe(true);
    expect(
      fake.requests.every((request) => request.authorization === 'Bearer test-token-value'),
    ).toBe(true);
  });

  test('older heads beyond the newest twenty are pruned, in the same run', async () => {
    for (let n = 1; n <= 22; n += 1) {
      for (const kind of ['gz', 'json']) {
        const name = `${SHA({ n })}.atlas.${kind}`;

        fake.assets.set(name, new Uint8Array([1]));
        fake.createdAt.set(name, new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString());
      }
    }

    fake.options.release = true;

    const result = await publish();

    expect(result.published && result.deleted.sort()).toEqual(
      [1, 2].flatMap((n) => [`${SHA({ n })}.atlas.gz`, `${SHA({ n })}.atlas.json`]).sort(),
    );
  });

  test('when the guard says no, nothing is asked of GitHub', async () => {
    env.GITHUB_EVENT_NAME = 'pull_request';

    const result = await publish();

    expect(result.published).toBe(false);
    expect(fake.requests).toEqual([]);

    env.GITHUB_EVENT_NAME = 'push';
    env.ATLAS_INDEX_KEY = '';
    await publish();
    expect(fake.requests).toEqual([]);
  });

  test('an upload URL that names another host is refused, and nothing is sent there', async () => {
    fake.options.foreignUploadUrl = true;
    const failure = await publish().then(
      () => undefined,
      (error: Error) => error,
    );

    expect(failure?.message).toContain('outside acme/src');
    expect(fake.requests.filter((request) => request.server === 'storage')).toEqual([]);
    expect(fake.assets.size).toBe(0);
  });

  test('a shallow checkout is refused before anything is asked of GitHub', async () => {
    const shallow = join(makeTempDirectory({ prefix: 'atlas-shallow-' }), 'work');

    git({
      cwd: makeTempDirectory({ prefix: 'atlas-shallow-cwd-' }),
      args: ['clone', '-q', '--depth', '1', `file://${bare}`, shallow],
    });
    const failure = await publishIndex({
      root: shallow,
      env,
      keyEnv: 'ATLAS_INDEX_KEY',
      atlasVersion: '9.9.9',
    }).then(
      () => undefined,
      (error: Error) => error,
    );

    expect(failure?.message).toContain('fetch-depth: 0');
    expect(fake.requests).toEqual([]);
  });

  test('the scratch folder is gone afterwards', async () => {
    await publish();
    expect(() => readFileSync(join(work, '.agents/local/tmp/atlas-index-out', 'x'))).toThrow();
    expect(git({ cwd: work, args: ['worktree', 'list'] }).split('\n')).toHaveLength(1);
  });
});

describe('the release tag is not a release (C25)', () => {
  test('a tag named atlas-index leaves the release table as it was', () => {
    const { work } = makeSourceRepository();
    const project = toAtlasProject({
      root: work,
      manifest: JSON.parse(readFileSync(join(work, MANIFEST_FILE), 'utf8')),
    });
    const before = JSON.stringify(computeReleases({ project }));

    git({ cwd: work, args: ['tag', 'atlas-index'] });
    expect(JSON.stringify(computeReleases({ project }))).toBe(before);
  });
});
