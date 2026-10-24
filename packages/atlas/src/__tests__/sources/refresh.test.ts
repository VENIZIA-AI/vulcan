import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { readAtlasProject } from '@/common/project-config';
import { buildSourcesServer, Refresher, refreshIntervalMs } from '@/server/index';
import { resolveSources } from '@/sources';
import type { IResolvedSource } from '@/sources';
import { restoreVariable } from '../env.helper';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previousCache = process.env.XDG_CACHE_HOME;

beforeEach(() => {
  process.env.XDG_CACHE_HOME = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  restoreVariable({ name: 'XDG_CACHE_HOME', value: previousCache });
  delete process.env.VULCAN_NPM_REGISTRY;
  delete process.env.VULCAN_ATLAS_REFRESH_SECONDS;
});

const call = async (opts: {
  transport: ReturnType<typeof buildSourcesServer>;
  name: string;
  args?: Record<string, unknown>;
}) => {
  const reply = JSON.parse(
    (await opts.transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: opts.name, arguments: opts.args ?? {} },
      }),
    })) ?? 'null',
  );

  return JSON.parse(reply.result.content[0].text);
};

/** Calls `read` until it answers `expected`, for a refresh that runs in the background. */
const eventually = async (opts: { read: () => Promise<unknown>; expected: unknown }) => {
  let last: unknown;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    last = await opts.read();

    if (JSON.stringify(last) === JSON.stringify(opts.expected)) {
      return last;
    }

    await Bun.sleep(50);
  }

  return last;
};

const newestOf = async (opts: { transport: ReturnType<typeof buildSourcesServer> }) =>
  (await call({ transport: opts.transport, name: 'version' })).snapshot['@x/kernel'];

describe('a remote source keeps up with its ref while the server runs', () => {
  test('a release tag pushed after the start shows up after the interval, with no restart', async () => {
    const source = makeSourceRepository();
    const sources = await resolveSources({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });
    const transport = buildSourcesServer({
      sources,
      cwd: sources[0].root,
      version: '0.0.0',
      refresh: { intervalMs: 20 },
    });

    expect(await newestOf({ transport })).toBe('1.0.0');

    writeSourceFile({ work: source.work, path: 'docs/notes.md', text: 'a release commit\n' });
    commitAll({ work: source.work, message: 'chore(kernel): release v1.1.0' });
    git({ cwd: source.work, args: ['tag', 'kernel-v1.1.0'] });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop', '--tags'] });
    await Bun.sleep(40);

    expect(await eventually({ read: () => newestOf({ transport }), expected: '1.1.0' })).toBe(
      '1.1.0',
    );
  });

  test('a new commit on the ref swaps the corpus: a search finds the new page', async () => {
    const source = makeSourceRepository();
    const sources = await resolveSources({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });
    const transport = buildSourcesServer({
      sources,
      cwd: sources[0].root,
      version: '0.0.0',
      refresh: { intervalMs: 20 },
    });
    const total = async () =>
      (await call({ transport, name: 'search', args: { query: 'bellows' } })).total;

    expect(await total()).toBe(0);

    writeSourceFile({
      work: source.work,
      path: '.agents/knowledge/overview/bellows.md',
      text: '---\ntype: Concept\ntitle: Bellows\ndescription: The bellows.\n---\n\nThe bellows feed the forge.\n',
    });
    commitAll({ work: source.work, message: 'docs: bellows' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });
    await Bun.sleep(40);

    expect(await eventually({ read: total, expected: 1 })).toBe(1);
  });

  test('inside the interval nothing is looked up again', async () => {
    const source = makeSourceRepository();
    const sources = await resolveSources({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });
    let lookups = 0;
    const transport = buildSourcesServer({
      sources,
      cwd: sources[0].root,
      version: '0.0.0',
      refresh: {
        intervalMs: 60_000,
        resolve: async () => {
          lookups += 1;

          return sources[0];
        },
      },
    });

    await newestOf({ transport });
    await newestOf({ transport });
    await Bun.sleep(30);

    expect(lookups).toBe(0);
  });

  test('a source that cannot be reached keeps serving what it has', async () => {
    const source = makeSourceRepository();
    const sources = await resolveSources({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });
    const transport = buildSourcesServer({
      sources,
      cwd: sources[0].root,
      version: '0.0.0',
      refresh: {
        intervalMs: 10,
        resolve: async () => {
          throw new Error('the remote is down');
        },
      },
    });

    await newestOf({ transport });
    await Bun.sleep(40);

    expect(await newestOf({ transport })).toBe('1.0.0');
  });
});

describe('the project itself keeps up with its own tags', () => {
  test('a release tag created while the server runs shows after the interval', async () => {
    const source = makeSourceRepository();
    const project: IResolvedSource = {
      name: 'src',
      root: source.work,
      mode: 'repository',
      project: readAtlasProject({ root: source.work }),
    };
    const transport = buildSourcesServer({
      sources: [project],
      cwd: source.work,
      version: '0.0.0',
      refresh: { intervalMs: 20 },
    });

    expect(await newestOf({ transport })).toBe('1.0.0');

    writeSourceFile({ work: source.work, path: 'docs/notes.md', text: 'a release commit\n' });
    commitAll({ work: source.work, message: 'chore(kernel): release v1.2.0' });
    git({ cwd: source.work, args: ['tag', 'kernel-v1.2.0'] });
    await Bun.sleep(40);

    expect(await eventually({ read: () => newestOf({ transport }), expected: '1.2.0' })).toBe(
      '1.2.0',
    );
  });
});

describe('Refresher', () => {
  test('a poke inside the interval does nothing; after it, one refresh runs; a second poke while it runs is ignored', async () => {
    let now = 0;
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresher = new Refresher({
      targets: [
        {
          refresh: async () => {
            runs += 1;
            await gate;
          },
        },
      ],
      intervalMs: 1000,
      now: () => now,
    });

    refresher.poke();
    now = 999;
    refresher.poke();
    expect(runs).toBe(0);

    now = 1000;
    refresher.poke();
    refresher.poke();
    expect(runs).toBe(1);

    release();
    await refresher.idle();
    now = 1500;
    refresher.poke();
    expect(runs).toBe(1);
    now = 2100;
    refresher.poke();
    await refresher.idle();
    expect(runs).toBe(2);
  });

  test('a target that throws neither stops the others nor the caller', async () => {
    let ran = false;
    const refresher = new Refresher({
      targets: [
        {
          refresh: async () => {
            throw new Error('boom');
          },
        },
        {
          refresh: async () => {
            ran = true;
          },
        },
      ],
      intervalMs: 0,
      now: () => 10,
    });

    refresher.poke();
    await refresher.idle();

    expect(ran).toBe(true);
  });
});

describe('refreshIntervalMs', () => {
  test('five minutes by default; VULCAN_ATLAS_REFRESH_SECONDS sets it; 0 turns it off', () => {
    expect(refreshIntervalMs()).toBe(300_000);

    process.env.VULCAN_ATLAS_REFRESH_SECONDS = '30';
    expect(refreshIntervalMs()).toBe(30_000);

    process.env.VULCAN_ATLAS_REFRESH_SECONDS = '0';
    expect(refreshIntervalMs()).toBeUndefined();

    process.env.VULCAN_ATLAS_REFRESH_SECONDS = 'soon';
    expect(refreshIntervalMs()).toBe(300_000);
  });
});
