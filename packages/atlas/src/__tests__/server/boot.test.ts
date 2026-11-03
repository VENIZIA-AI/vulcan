import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { SourceBoot, SourceNotice, SourcesServer } from '@/server/index';
import { SourceResolver } from '@/sources';
import type { IAtlasSource, IResolvedSource } from '@/sources';
import {
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  SOURCE_MANIFEST,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from '../sources/source-repo.helper';

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
  delete process.env.VULCAN_ATLAS_INDEX_JOBS;
  delete process.env.VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS;
});

const declared = (names: string[]): IAtlasSource[] =>
  names.map((name) => ({ name, repo: `file:///none/${name}.git`, ref: 'develop' }));

/** A promise settled from outside, to hold an indexer until the test lets it go. */
const gate = <T>() => {
  let release!: (value: T) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });

  return { promise, release, fail };
};

describe('SourceBoot', () => {
  test('never runs more builds at once than its cap, and every source finishes', async () => {
    let running = 0;
    let peak = 0;
    const ready: string[] = [];
    const boot = new SourceBoot({
      sources: declared(['a', 'b', 'c', 'd', 'e']),
      concurrency: 2,
      indexer: async ({ source }) => {
        running += 1;
        peak = Math.max(peak, running);
        await Bun.sleep(15);
        running -= 1;

        return { name: source.name } as IResolvedSource;
      },
    });

    boot.listen({ onReady: ({ resolved }) => ready.push(resolved.name) });
    boot.start();
    await boot.settled;

    expect(peak).toBe(2);
    expect([...ready].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(boot.indexing()).toEqual([]);
  });

  test('a source that fails is set aside with its reason; the others are not held back', async () => {
    const ready: string[] = [];
    const boot = new SourceBoot({
      sources: declared(['good', 'bad', 'late']),
      concurrency: 1,
      indexer: async ({ source }) => {
        if (source.name === 'bad') {
          throw new Error('the ref does not exist');
        }

        return { name: source.name } as IResolvedSource;
      },
    });

    boot.listen({ onReady: ({ resolved }) => ready.push(resolved.name) });
    boot.start();
    await boot.settled;

    expect(ready).toEqual(['good', 'late']);
    expect(boot.unavailable().map((entry) => [entry.source.name, entry.reason])).toEqual([
      ['bad', 'the ref does not exist'],
    ]);
  });

  test('waitFor returns at the time limit with sources still indexing, and at once when all are done', async () => {
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({
      sources: declared(['slow']),
      indexer: () => held.promise,
    });

    boot.listen({ onReady: () => undefined });
    boot.start();

    const started = performance.now();

    await boot.waitFor({ ms: 40 });

    expect(performance.now() - started).toBeGreaterThanOrEqual(35);
    expect(boot.indexing().map((source) => source.name)).toEqual(['slow']);

    held.release({ name: 'slow' } as IResolvedSource);

    const again = performance.now();

    await boot.waitFor({ ms: 5_000 });

    expect(performance.now() - again).toBeLessThan(1_000);
    expect(boot.indexing()).toEqual([]);
  });

  test('waitFor with a source name returns when that source is done, not the others', async () => {
    const fast = gate<IResolvedSource>();
    const slow = gate<IResolvedSource>();
    const boot = new SourceBoot({
      sources: declared(['fast', 'slow']),
      concurrency: 2,
      indexer: ({ source }) => (source.name === 'fast' ? fast.promise : slow.promise),
    });

    boot.listen({ onReady: () => undefined });
    boot.start();
    fast.release({ name: 'fast' } as IResolvedSource);

    const started = performance.now();

    await boot.waitFor({ ms: 5_000, source: 'fast' });

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(boot.indexing().map((source) => source.name)).toEqual(['slow']);

    // A name that is not declared does not wait at all.
    const unknown = performance.now();

    await boot.waitFor({ ms: 5_000, source: 'nobody' });

    expect(performance.now() - unknown).toBeLessThan(1_000);
    slow.release({ name: 'slow' } as IResolvedSource);
    await boot.settled;
  });

  test('the cap is the core count held back by free memory, and an override wins', () => {
    expect(SourceBoot.concurrencyOf()).toBeGreaterThanOrEqual(1);

    process.env.VULCAN_ATLAS_INDEX_JOBS = '2';

    expect(SourceBoot.concurrencyOf()).toBe(2);

    process.env.VULCAN_ATLAS_INDEX_JOBS = 'many';

    expect(SourceBoot.concurrencyOf()).toBeGreaterThanOrEqual(1);
  });

  test('the wait of a call and the time of a build are read from the environment, with defaults', () => {
    expect(SourceBoot.callWaitMs()).toBe(20_000);
    expect(SourceBoot.buildTimeoutMs()).toBe(600_000);

    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '0';
    process.env.VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS = '90';

    expect(SourceBoot.callWaitMs()).toBe(0);
    expect(SourceBoot.buildTimeoutMs()).toBe(90_000);
  });
});

describe('a server whose sources are still being indexed', () => {
  const makeConsumer = (): string => {
    const work = makeTempDirectory({ prefix: 'atlas-consumer-' });

    writeSourceFile({
      work,
      path: '.agents/vulcan.manifest.json',
      text: SOURCE_MANIFEST.replace('"name": "src"', '"name": "own"'),
    });
    writeSourceFile({
      work,
      path: '.agents/knowledge/overview/lighthouse.md',
      text: '---\ntype: Concept\ntitle: Lighthouse\ndescription: The lighthouse.\n---\n\nThe lighthouse keeper starts the kernel.\n',
    });

    return work;
  };

  const rpc = async (opts: {
    server: ReturnType<typeof SourcesServer.build>;
    method: string;
    params?: object;
  }) => {
    const line = await opts.server.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: opts.method,
        params: opts.params ?? {},
      }),
    });

    return JSON.parse(line ?? 'null');
  };

  const search = async (opts: { server: ReturnType<typeof SourcesServer.build> }) => {
    const reply = await rpc({
      server: opts.server,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'kernel boots' } },
    });

    return reply.error === undefined ? JSON.parse(reply.result.content[0].text) : reply;
  };

  test('answers initialize and tools/list while no source is ready, then serves each as it lands', async () => {
    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '0';

    const cwd = makeConsumer();
    const repository = makeSourceRepository();
    const source: IAtlasSource = { name: 'src', repo: repository.url, ref: 'develop' };
    const { resolved } = await SourceResolver.resolveServable({ cwd, cacheDir, sources: [] });
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({ sources: [source], indexer: () => held.promise });
    const server = SourcesServer.build({ sources: resolved, cwd, version: '0.0.0', boot });
    const initialized = await rpc({ server, method: 'initialize' });
    const listed = await rpc({ server, method: 'tools/list' });

    expect(initialized.result.serverInfo.name).toBe('own-atlas');
    expect(initialized.result.instructions).toContain('- src: INDEXING');
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain('search');

    // Not searchable yet: the answer says so instead of looking complete.
    const early = await search({ server });

    expect(early.hits.every((hit: { source: string }) => hit.source === 'own')).toBe(true);
    expect(early.notServed.indexing).toEqual(['src']);
    expect(early.notServed.message).toContain('src is still being indexed');
    expect(early.notServed.answeredFrom).toEqual(['own']);

    const landed = await SourceResolver.resolveRemote({ source, cwd, cacheDir });

    held.release(landed);
    await boot.settled;

    const late = await search({ server });

    expect(late.notServed).toBeUndefined();
    expect(late.hits.map((hit: { source: string }) => hit.source)).toContain('src');
    const again = await rpc({ server, method: 'initialize' });

    expect(again.result.instructions).not.toContain('INDEXING');
  });

  test('a call waits for a source that lands inside its time limit, and answers complete', async () => {
    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '10';

    const cwd = makeConsumer();
    const repository = makeSourceRepository();
    const source: IAtlasSource = { name: 'src', repo: repository.url, ref: 'develop' };
    const { resolved } = await SourceResolver.resolveServable({ cwd, cacheDir, sources: [] });
    const held = gate<IResolvedSource>();
    const boot = new SourceBoot({ sources: [source], indexer: () => held.promise });
    const server = SourcesServer.build({ sources: resolved, cwd, version: '0.0.0', boot });
    const pending = search({ server });

    await Bun.sleep(30);
    const landed = await SourceResolver.resolveRemote({ source, cwd, cacheDir });

    held.release(landed);

    const answer = await pending;

    expect(answer.notServed).toBeUndefined();
    expect(answer.hits.map((hit: { source: string }) => hit.source)).toContain('src');
  });

  test('a source that failed is named in every answer and in an error; the project still answers', async () => {
    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '5';

    const cwd = makeConsumer();
    const { resolved } = await SourceResolver.resolveServable({ cwd, cacheDir, sources: [] });
    const boot = new SourceBoot({
      sources: declared(['gone']),
      indexer: async () => {
        throw new Error('the repository is not there');
      },
    });
    const server = SourcesServer.build({ sources: resolved, cwd, version: '0.0.0', boot });
    const answer = await search({ server });
    const unknown = await rpc({
      server,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'kernel', source: 'gone' } },
    });

    expect(answer.hits.length).toBeGreaterThan(0);
    expect(answer.notServed.failed).toEqual([
      { source: 'gone', reason: 'the repository is not there' },
    ]);
    expect(answer.notServed.indexing).toEqual([]);
    expect(unknown.error.message).toContain('unknown source');
    expect(unknown.error.message).toContain('gone could not be indexed');
  });

  test('sources are served in the config order whichever finishes first', async () => {
    process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS = '5';

    const cwd = makeConsumer();
    const first = makeSourceRepository();
    const second = makeSourceRepository();
    const one: IAtlasSource = { name: 'one', repo: first.url, ref: 'develop' };
    const two: IAtlasSource = { name: 'two', repo: second.url, ref: 'develop' };
    const { resolved } = await SourceResolver.resolveServable({ cwd, cacheDir, sources: [] });
    const boot = new SourceBoot({
      sources: [one, two],
      concurrency: 2,
      indexer: async ({ source }) => {
        // The second source is ready long before the first.
        await Bun.sleep(source.name === 'one' ? 80 : 0);

        return SourceResolver.resolveRemote({ source, cwd, cacheDir });
      },
    });
    const server = SourcesServer.build({ sources: resolved, cwd, version: '0.0.0', boot });

    await boot.settled;

    const reply = await rpc({ server, method: 'initialize' });
    const text = reply.result.instructions as string;

    expect(text.indexOf('- own: this repository')).toBeLessThan(text.indexOf('- one: '));
    expect(text.indexOf('- one: ')).toBeLessThan(text.indexOf('- two: '));
  });
});

describe('SourceNotice', () => {
  test('is absent when every declared source is ready, and leaves a non-object answer as it is', async () => {
    const boot = new SourceBoot({ sources: [], indexer: async () => ({}) as IResolvedSource });

    expect(SourceNotice.of({ boot, answeredFrom: ['own'] })).toBeUndefined();
    expect(SourceNotice.attach({ result: [1, 2], notice: undefined })).toEqual([1, 2]);
    expect(
      SourceNotice.attach({
        result: [1, 2],
        notice: { answeredFrom: [], indexing: ['a'], failed: [], message: 'm' },
      }),
    ).toEqual([1, 2]);
  });
});

describe('a source indexed in a child process', () => {
  test('is resolved from the child, with its index on disk', async () => {
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const repository = makeSourceRepository();

    writeSourceFile({
      work: cwd,
      path: '.agents/vulcan.manifest.json',
      text: SOURCE_MANIFEST.replace('"name": "src"', '"name": "own"').replace(
        '"packages"',
        `"sources": [{ "name": "src", "repo": "${repository.url}", "ref": "develop" }], "packages"`,
      ),
    });

    const resolved = await SourceBoot.indexInChild({
      source: { name: 'src', repo: repository.url, ref: 'develop' },
      args: ['--root', cwd, `--cache-dir=${cacheDir}`],
      timeoutMs: 120_000,
    });

    expect(resolved.name).toBe('src');
    expect(resolved.mode).toBe('fresh');
    expect(resolved.indexFile).toBeDefined();
    const exists = await Bun.file(resolved.indexFile ?? '').exists();

    expect(exists).toBe(true);
  }, 150_000);

  test('a source that cannot be reached fails with the child message, not a hang', async () => {
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });

    writeSourceFile({
      work: cwd,
      path: '.agents/vulcan.manifest.json',
      text: SOURCE_MANIFEST.replace('"name": "src"', '"name": "own"').replace(
        '"packages"',
        `"sources": [{ "name": "gone", "repo": "file://${cwd}/no-such.git", "ref": "develop" }], "packages"`,
      ),
    });

    const failure = await SourceBoot.indexInChild({
      source: { name: 'gone', repo: `file://${cwd}/no-such.git`, ref: 'develop' },
      args: ['--root', cwd, `--cache-dir=${cacheDir}`],
      timeoutMs: 120_000,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('is unreachable');
  }, 150_000);

  test('a child past the time limit is stopped and the source fails', async () => {
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const repository = makeSourceRepository();

    writeSourceFile({
      work: cwd,
      path: '.agents/vulcan.manifest.json',
      text: SOURCE_MANIFEST.replace('"name": "src"', '"name": "own"').replace(
        '"packages"',
        `"sources": [{ "name": "src", "repo": "${repository.url}", "ref": "develop" }], "packages"`,
      ),
    });

    const failure = await SourceBoot.indexInChild({
      source: { name: 'src', repo: repository.url, ref: 'develop' },
      args: ['--root', cwd, `--cache-dir=${cacheDir}`],
      timeoutMs: 1,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('took longer than');
  }, 60_000);
});
