import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FileSourceMemory,
  SourceBoot,
  SourceNotice,
  SourceStatus,
  SourcesServer,
} from '@/server/index';
import type { ISourceMemory, ISourceRecord } from '@/server/index';
import { SourceResolver } from '@/sources';
import type { IAtlasSource, IResolvedSource } from '@/sources';
import {
  commitAll,
  git,
  install,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  SOURCE_MANIFEST,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from '../sources/source-repo.helper';
import { CapturedStderr } from '../helpers/stderr.helper';
import { SymbolFetches } from '../sources/symbol-fetches.helper';

let stderr: CapturedStderr;

beforeEach(() => {
  stderr = CapturedStderr.start();
});

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let cacheDir: string;

beforeEach(() => {
  cacheDir = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  delete process.env.VULCAN_NPM_REGISTRY;
  delete process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS;
});

const gate = <T>() => {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });

  return { promise, release };
};

const declared = (names: string[]): IAtlasSource[] =>
  names.map((name) => ({ name, repo: `file:///none/${name}.git`, ref: 'develop' }));
const memoryOf = (opts: {
  last?: IResolvedSource;
  expectedMs?: number;
  records?: { name: string; entry: ISourceRecord }[];
  pruned?: string[][];
}): ISourceMemory => ({
  lastGood: () => opts.last,
  expectedMs: () => opts.expectedMs,
  record: ({ source, entry }) => opts.records?.push({ name: source.name, entry }),
  prune: ({ keep }) => opts.pruned?.push(keep),
});

/** A released source repository (tags kernel-v1.0.0 and kernel-v1.1.0) and a consumer that has its own manifest. */
const world = () => {
  const repository = makeSourceRepository();

  writeSourceFile({ work: repository.work, path: 'docs/notes.md', text: 'a later release\n' });
  commitAll({ work: repository.work, message: 'chore(kernel): release v1.1.0' });
  git({ cwd: repository.work, args: ['tag', 'kernel-v1.1.0'] });
  git({ cwd: repository.work, args: ['push', '-q', 'origin', 'develop', '--tags'] });

  const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });

  writeSourceFile({
    work: cwd,
    path: '.agents/vulcan.manifest.json',
    text: SOURCE_MANIFEST.replace('"name": "src"', '"name": "own"'),
  });
  writeSourceFile({
    work: cwd,
    path: '.agents/knowledge/overview/lighthouse.md',
    text: '---\ntype: Concept\ntitle: Lighthouse\ndescription: The lighthouse.\n---\n\nThe lighthouse keeper starts the kernel.\n',
  });

  return {
    repository,
    cwd,
    source: { name: 'src', repo: repository.url, ref: 'develop' } as IAtlasSource,
  };
};

let fetches: SymbolFetches;

beforeEach(() => {
  fetches = SymbolFetches.watch();
});

afterEach(() => {
  fetches.restore();
});

/** Registered last: it fails on an unclaimed line, and a failing hook skips the hooks after it. */
afterEach(() => {
  stderr.restore();
});

describe('a source served from its last good index while the remote is checked again', () => {
  test('is ready at once for the calls that wait, is not "indexing", and the fresh index replaces it', async () => {
    const stale = { name: 'a', sha: 'oldoldold' } as IResolvedSource;
    const fresh = { name: 'a', sha: 'newnewnew' } as IResolvedSource;
    const held = gate<IResolvedSource>();
    const records: { name: string; entry: ISourceRecord }[] = [];
    const seen: { sha?: string; isReplacement?: boolean }[] = [];
    const boot = new SourceBoot({
      sources: declared(['a']),
      memory: memoryOf({ last: stale, records }),
      indexer: () => held.promise,
    });

    boot.listen({
      onReady: ({ resolved, isReplacement }) => seen.push({ sha: resolved.sha, isReplacement }),
    });
    boot.start();

    const began = Date.now();

    await boot.waitFor({ ms: 5000 });
    expect(Date.now() - began).toBeLessThan(1000);
    expect(seen).toEqual([{ sha: 'oldoldold', isReplacement: undefined }]);
    expect(boot.indexing()).toEqual([]);
    expect(boot.unavailable()).toEqual([]);
    expect(boot.progress()[0]).toMatchObject({
      source: 'a',
      state: 'building',
      isStale: true,
      staleAt: 'oldoldo',
    });

    held.release(fresh);
    await boot.fresh;
    expect(seen.at(-1)).toEqual({ sha: 'newnewnew', isReplacement: true });
    expect(boot.progress()[0]).toMatchObject({ state: 'ready', isStale: false });
    expect(boot.progress()[0]?.staleAt).toBeUndefined();
    expect(records.map((entry) => entry.entry.state)).toEqual(['building', 'ready']);
    expect(records[0]?.entry.pid).toBe(process.pid);
    expect(records.at(-1)?.entry.resolved).toEqual(fresh);
  });

  test('`settled` is the older index handed over; `fresh` waits for the build itself', async () => {
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({
      sources: declared(['a']),
      memory: memoryOf({ last: { name: 'a' } as IResolvedSource }),
      indexer: () => held.promise,
    });
    let isFresh = false;

    boot.start();
    const watching = boot.fresh.then(() => {
      isFresh = true;
    });
    await boot.settled;
    await Bun.sleep(20);
    expect(isFresh).toBe(false);
    held.release({ name: 'a' } as IResolvedSource);
    await watching;
    expect(isFresh).toBe(true);
  });

  test('a failed check keeps serving the older index: recorded, named in the notice, not unserved', async () => {
    const records: { name: string; entry: ISourceRecord }[] = [];
    const boot = new SourceBoot({
      sources: declared(['a']),
      memory: memoryOf({ last: { name: 'a', sha: 'abcdef123456' } as IResolvedSource, records }),
      indexer: async () => {
        throw new Error('the remote is down');
      },
    });

    boot.start();
    await boot.fresh;
    expect(boot.unavailable()).toEqual([]);
    expect(boot.indexing()).toEqual([]);
    expect(records.at(-1)?.entry).toMatchObject({ state: 'failed', error: 'the remote is down' });

    const notice = SourceNotice.of({ boot, answeredFrom: ['a'] });

    expect(notice?.stale).toEqual([
      { source: 'a', at: 'abcdef1', refreshError: 'the remote is down' },
    ]);
    expect(notice?.message).toContain(
      'a could not be refreshed (the remote is down) and stays at abcdef1',
    );
    expect(notice?.message).not.toContain('covers only');

    stderr.claim({
      parts: [
        '[SourceBoot] source not refreshed, the last good index is served | source: a | reason: the remote is down',
      ],
    });
  });

  test('a hand-over that throws is a normal build: the source is not left unsettled and the queue goes on', async () => {
    const ready: string[] = [];
    const boot = new SourceBoot({
      sources: declared(['a', 'b']),
      concurrency: 1,
      memory: {
        ...memoryOf({}),
        lastGood: ({ source }) =>
          source.name === 'a' ? ({ name: 'a' } as IResolvedSource) : undefined,
      },
      indexer: async ({ source }) => ({ name: source.name }) as IResolvedSource,
    });
    let thrown = 0;

    boot.listen({
      onReady: ({ resolved, isReplacement }) => {
        if (thrown === 0) {
          thrown += 1;
          throw new Error('the index is corrupted');
        }

        ready.push(`${resolved.name}${isReplacement === true ? '*' : ''}`);
      },
    });
    boot.start();
    await boot.fresh;
    await boot.settled;
    expect(ready).toEqual(['a', 'b']);
    expect(boot.unavailable()).toEqual([]);
    expect(boot.progress().map((entry) => entry.state)).toEqual(['ready', 'ready']);

    stderr.claim({
      parts: [
        '[SourceBoot] the last good index could not be opened, the source is built again | source: a | error: the index is corrupted',
      ],
    });
  });

  test('without a last good index a failure is unserved, as before', async () => {
    const boot = new SourceBoot({
      sources: declared(['a']),
      memory: memoryOf({}),
      indexer: async () => {
        throw new Error('nothing there');
      },
    });

    boot.start();
    await boot.settled;
    expect(boot.unavailable().map((entry) => entry.source.name)).toEqual(['a']);
    expect(boot.progress()[0]?.state).toBe('failed');

    stderr.claim({ parts: ['[SourceBoot] source not served | source: a | reason: nothing there'] });
  });

  test('the record is pruned to the declared sources when the boot starts', () => {
    const pruned: string[][] = [];
    const boot = new SourceBoot({
      sources: declared(['a', 'b']),
      memory: memoryOf({ pruned }),
      indexer: async ({ source }) => ({ name: source.name }) as IResolvedSource,
    });

    boot.start();
    expect(pruned).toEqual([['a', 'b']]);
  });
});

describe('the notice says how far each source has got', () => {
  test('N of M counts the project in both sides, computed from what is served, building and failed', async () => {
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({
      sources: declared(['a', 'b', 'c']),
      concurrency: 1,
      indexer: async ({ source }) => {
        if (source.name === 'a') {
          return { name: 'a' } as IResolvedSource;
        }

        if (source.name === 'b') {
          throw new Error('gone');
        }

        return held.promise;
      },
    });

    boot.start();
    await Bun.sleep(30);

    // own + a are served, b failed, c is building: 2 of 4.
    const notice = SourceNotice.of({ boot, answeredFrom: ['own', 'a'] });

    expect(notice?.ready).toEqual({ count: 2, total: 4 });
    expect(notice?.message).toContain('2 of 4 sources are ready');
    held.release({ name: 'c' } as IResolvedSource);
    await boot.fresh;

    stderr.claim({ parts: ['[SourceBoot] source not served | source: b | reason: gone'] });
  });

  test('seconds so far against the usual time, and when to ask again', async () => {
    let clock = 1_000_000;
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({
      sources: declared(['a', 'b']),
      concurrency: 2,
      now: () => clock,
      memory: memoryOf({ expectedMs: 25_000 }),
      indexer: () => held.promise,
    });

    boot.start();
    clock += 10_000;

    const notice = SourceNotice.of({ boot, answeredFrom: ['own'] });

    expect(notice?.building).toEqual([
      { source: 'a', elapsedSeconds: 10, expectedSeconds: 25 },
      { source: 'b', elapsedSeconds: 10, expectedSeconds: 25 },
    ]);
    expect(notice?.retryInSeconds).toBe(15);
    expect(notice?.message).toContain('a is being indexed (10 s so far, usually about 25 s)');
    held.release({ name: 'x' } as IResolvedSource);
    await boot.fresh;
  });

  test('with no recorded duration it asks again in 30 s, and never in under 5', () => {
    const boot = new SourceBoot({
      sources: declared(['a']),
      indexer: () => new Promise(() => undefined),
    });

    boot.start();
    expect(SourceNotice.of({ boot, answeredFrom: [] })?.retryInSeconds).toBe(30);

    let clock = 0;
    const slow = new SourceBoot({
      sources: declared(['a']),
      now: () => clock,
      memory: memoryOf({ expectedMs: 3000 }),
      indexer: () => new Promise(() => undefined),
    });

    slow.start();
    clock = 60_000;
    expect(SourceNotice.of({ boot: slow, answeredFrom: [] })?.retryInSeconds).toBe(5);
  });

  test('a source served from an older index is named while it refreshes', () => {
    const boot = new SourceBoot({
      sources: declared(['a']),
      memory: memoryOf({ last: { name: 'a', sha: '1234567890' } as IResolvedSource }),
      indexer: () => new Promise(() => undefined),
    });

    boot.start();

    const notice = SourceNotice.of({ boot, answeredFrom: ['own', 'a'] });

    expect(notice?.message).toBe(
      '2 of 2 sources are ready; a is answered from 1234567 while it refreshes',
    );
  });
});

describe('the record beside the cache', () => {
  test('a missing, corrupt or foreign file reads as empty; a record keeps the other sources; a temporary leftover goes', () => {
    const file = SourceStatus.fileOf({ cacheBase: cacheDir });

    expect(SourceStatus.read({ file })).toEqual({});
    mkdirSync(join(cacheDir, 'atlas'), { recursive: true });
    writeFileSync(file, '{ nope');
    expect(SourceStatus.read({ file })).toEqual({});
    writeFileSync(file, JSON.stringify({ version: 9, sources: { a: {} } }));
    expect(SourceStatus.read({ file })).toEqual({});
    SourceStatus.record({ file, name: 'a', entry: { state: 'ready', since: 1, durationMs: 5 } });
    SourceStatus.record({ file, name: 'b', entry: { state: 'failed', since: 2, error: 'x' } });
    expect(Object.keys(SourceStatus.read({ file })).sort()).toEqual(['a', 'b']);

    writeFileSync(`${file}.4242.tmp`, 'half');
    SourceStatus.prune({ file, keep: ['a'] });
    expect(Object.keys(SourceStatus.read({ file }))).toEqual(['a']);
    expect(readdirSync(join(cacheDir, 'atlas')).filter((name) => name.endsWith('.tmp'))).toEqual(
      [],
    );

    stderr.claim({
      parts: [
        '[SourceStatus] the record of the sources cannot be read, it is ignored | file:',
        'JSON Parse error',
      ],
    });
  });
});

describe('FileSourceMemory.lastGood', () => {
  test('is used only while the declared source is the same and its set is complete and of this format', async () => {
    const { cwd, source } = world();
    const resolved = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const memory = new FileSourceMemory({ cwd, cacheBase: cacheDir });

    expect(memory.lastGood({ source })).toBeUndefined();
    memory.record({ source, entry: { state: 'ready', since: 1, durationMs: 4000, resolved } });
    expect(memory.lastGood({ source })?.sha).toBe(resolved.sha);
    expect(memory.expectedMs({ source })).toBe(4000);
    // A build that starts or fails keeps the last good index and the duration.
    memory.record({ source, entry: { state: 'building', since: 2 } });
    expect(memory.lastGood({ source })?.sha).toBe(resolved.sha);
    // Another ref is another source.
    expect(memory.lastGood({ source: { ...source, ref: 'main' } })).toBeUndefined();

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });

  test('is not served after an atlas upgrade moved the index format (H2)', async () => {
    const { cwd, source } = world();
    const resolved = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const memory = new FileSourceMemory({ cwd, cacheBase: cacheDir });

    memory.record({ source, entry: { state: 'ready', since: 1, resolved } });
    expect(memory.lastGood({ source })).toBeDefined();
    writeFileSync(join(resolved.indexFile ?? '', '..', 'format'), '0\n');
    expect(memory.lastGood({ source })).toBeUndefined();

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });

  test('is not served when its index is gone from disk, or the set lost its complete marker', async () => {
    const { cwd, source } = world();
    const resolved = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const memory = new FileSourceMemory({ cwd, cacheBase: cacheDir });

    memory.record({ source, entry: { state: 'ready', since: 1, resolved } });
    rmSync(join(resolved.indexFile ?? '', '..', 'complete'), { force: true });
    expect(memory.lastGood({ source })).toBeUndefined();

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });

  test('never serves an older index to a command that needs the fresh build (B1)', async () => {
    const { cwd, source } = world();
    const resolved = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const fresh = new FileSourceMemory({ cwd, cacheBase: cacheDir, isStaleAllowed: false });

    fresh.record({ source, entry: { state: 'ready', since: 1, resolved } });
    expect(fresh.lastGood({ source })).toBeUndefined();
    expect(new FileSourceMemory({ cwd, cacheBase: cacheDir }).lastGood({ source })).toBeDefined();

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });

  test('with the docs pinned to the installed version, an upgrade drops the older index (B2)', async () => {
    const { cwd, source } = world();

    install({ root: cwd, name: '@x/kernel', version: '1.0.0' });

    const resolved = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const memory = new FileSourceMemory({ cwd, cacheBase: cacheDir });

    expect(resolved.pin?.pinned).toBe(true);
    expect(resolved.pin?.ref).toBe('kernel-v1.0.0');
    memory.record({ source, entry: { state: 'ready', since: 1, resolved } });
    expect(memory.lastGood({ source })?.pin?.ref).toBe('kernel-v1.0.0');

    install({ root: cwd, name: '@x/kernel', version: '1.1.0' });
    expect(memory.lastGood({ source })).toBeUndefined();

    install({ root: cwd, name: '@x/kernel', version: '1.0.0' });
    expect(memory.lastGood({ source })?.pin?.ref).toBe('kernel-v1.0.0');
    rmSync(join(cwd, 'node_modules'), { recursive: true, force: true });
    expect(memory.lastGood({ source })).toBeUndefined();

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });
});

describe('a server that starts with a recorded source', () => {
  test('answers from it at once, names it in the notice, and the fresh index replaces it without a second copy', async () => {
    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '0';

    const { cwd, source } = world();
    const landed = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const memory = new FileSourceMemory({ cwd, cacheBase: cacheDir });

    memory.record({
      source,
      entry: { state: 'ready', since: 1, durationMs: 4000, resolved: landed },
    });

    const { resolved } = await SourceResolver.resolveServable({ cwd, cacheDir, sources: [] });
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({ sources: [source], memory, indexer: () => held.promise });
    const server = SourcesServer.build({ sources: resolved, cwd, version: '0.0.0', boot });

    const ask = async () => {
      const line = await server.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'kernel boots' } },
        }),
      });

      return JSON.parse(JSON.parse(line ?? 'null').result.content[0].text);
    };

    const first = await ask();
    const from = (answer: { hits: { source: string }[] }) =>
      answer.hits.filter((hit) => hit.source === 'src').length;

    expect(first.notServed.stale).toHaveLength(1);
    expect(first.notServed.indexing).toEqual([]);
    expect(first.notServed.ready).toEqual({ count: 2, total: 2 });
    expect(from(first)).toBeGreaterThan(0);

    held.release(landed);
    await boot.fresh;

    const second = await ask();

    expect(second.notServed).toBeUndefined();
    expect(from(second)).toBe(from(first));

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });
});

describe('the refresher and a source whose child is still building', () => {
  test('skips the pull while the boot builds the source, and looks again once it is done', async () => {
    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '0';

    const { cwd, source } = world();
    const landed = await SourceResolver.resolveRemote({ source, cwd, cacheDir });
    const memory = new FileSourceMemory({ cwd, cacheBase: cacheDir });

    memory.record({ source, entry: { state: 'ready', since: 1, resolved: landed } });

    const { resolved } = await SourceResolver.resolveServable({ cwd, cacheDir, sources: [] });
    const held = gate<IResolvedSource>();
    let pulls = 0;
    let clock = 0;
    const boot = new SourceBoot({ sources: [source], memory, indexer: () => held.promise });
    const server = SourcesServer.build({
      sources: resolved,
      cwd,
      version: '0.0.0',
      boot,
      refresh: {
        intervalMs: 10,
        now: () => clock,
        resolve: async () => {
          pulls += 1;

          return landed;
        },
      },
    });

    const poke = async (): Promise<void> => {
      clock += 100;
      await server.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'presets', arguments: {} },
        }),
      });
      await Bun.sleep(20);
    };

    // Stale is being served and the child is building: no overlapping pull.
    await poke();
    expect(pulls).toBe(0);

    held.release(landed);
    await boot.fresh;
    await poke();
    expect(pulls).toBe(1);

    await fetches.claimUnfetched({ stderr, release: '@x/kernel@1.1.0' });
  });
});
