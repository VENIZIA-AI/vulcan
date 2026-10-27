import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cacheRootOf } from '@/sources';
import {
  makeTempDirectory,
  NO_REGISTRY,
  SOURCE_MANIFEST,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from '../sources/source-repo.helper';
import { startFakeGithub } from './fake-github.helper';
import type { IFakeGithub } from './fake-github.helper';
import { makePrebuiltSource } from './pair.helper';

const CLI = join(__dirname, '..', '..', 'cli.ts');

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let fake: IFakeGithub;

beforeEach(() => {
  fake = startFakeGithub({ owner: 'acme', repo: 'src' });
});

afterEach(async () => {
  await fake.stop();
});

/** A project that reads `acme/src` as a source, with its manifest as `vulcan sync` would write it. */
const consumer = (opts: { atlas?: Record<string, unknown> }): string => {
  const root = makeTempDirectory({ prefix: 'atlas-consumer-' });
  const manifest = {
    ...JSON.parse(SOURCE_MANIFEST),
    name: 'own',
    sources: [{ name: 'src', repo: 'acme/src', ref: 'develop' }],
    ...(opts.atlas === undefined ? {} : { atlas: opts.atlas }),
  };

  writeSourceFile({
    work: root,
    path: '.agents/vulcan.manifest.json',
    text: JSON.stringify(manifest),
  });

  return root;
};

/** `atlas pull`, as a process: the fake lives in this one, so the spawn must not block it. */
const pull = async (opts: { root: string; cache: string; bare: string; flags?: string[] }) => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      CLI,
      'pull',
      '--root',
      opts.root,
      '--cache-dir',
      opts.cache,
      ...(opts.flags ?? []),
    ],
    cwd: opts.root,
    env: {
      ...process.env,
      VULCAN_GITHUB_API_URL: fake.apiUrl,
      GITHUB_TOKEN: 'test-token-value',
      VULCAN_NPM_REGISTRY: NO_REGISTRY,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${opts.bare}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/acme/src.git',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await child.exited;

  return { code: child.exitCode, stdout: await new Response(child.stdout).text() };
};

/** Whether the pulled set was installed from a downloaded pair. */
const usedPair = (opts: { cache: string }): boolean => {
  const root = cacheRootOf({ repo: 'acme/src', cacheBase: opts.cache });
  const sets = readdirSync(root).filter((name) => name.endsWith('.atlas'));

  return sets.some((set) => existsSync(join(root, set, 'prebuilt')));
};

describe('the project can turn the download off (C28)', () => {
  const setup = () => {
    const source = makePrebuiltSource();

    fake.assets.set(`${source.pair.sha}.atlas.json`, Buffer.from(source.pair.envelope));
    fake.assets.set(`${source.pair.sha}.atlas.gz`, source.pair.gz);

    return source;
  };

  test('with nothing set, a pull downloads the pair', async () => {
    const source = setup();
    const cache = makeTempDirectory({ prefix: 'atlas-cache-' });
    const result = await pull({ root: consumer({}), cache, bare: source.bare });

    expect(result.code).toBe(0);
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(usedPair({ cache })).toBe(true);
  });

  test('atlas.prebuilt false in the manifest makes no request for any source', async () => {
    const source = setup();
    const cache = makeTempDirectory({ prefix: 'atlas-cache-' });
    const result = await pull({
      root: consumer({ atlas: { prebuilt: false } }),
      cache,
      bare: source.bare,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('pull: src');
    expect(fake.requests).toEqual([]);
    expect(usedPair({ cache })).toBe(false);
  });

  test('--no-prebuilt does the same, whatever the manifest says', async () => {
    const source = setup();
    const cache = makeTempDirectory({ prefix: 'atlas-cache-' });
    const result = await pull({
      root: consumer({}),
      cache,
      bare: source.bare,
      flags: ['--no-prebuilt'],
    });

    expect(result.code).toBe(0);
    expect(fake.requests).toEqual([]);
    expect(usedPair({ cache })).toBe(false);
  });
});
