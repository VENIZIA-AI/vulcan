import { describe, expect, test } from 'bun:test';
import type { IChunk } from '@/corpus';
import { Transport } from '@/protocol';
import { RpcErrorCodes } from '@/protocol/common';
import { ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { SourceChunks, SourceReleases, SourceSymbols } from '@/sources';
import { SymbolStore } from '@/symbols';
import { buildChangesTool, buildSearchTool } from '@/tools';

const chunk = (opts: { id: string; document: string; body: string }): IChunk => ({
  id: opts.id,
  corpus: 'wiki',
  document: opts.document,
  anchor: opts.id.split('#')[1] ?? '',
  headingPath: opts.document,
  title: opts.document,
  body: opts.body,
  symbols: '',
  metadata: '',
  authority: 1,
});

const indexOf = (opts: { chunks: IChunk[] }): ChunkStore => {
  const store = new ChunkStore();

  store.add({ chunks: opts.chunks });

  return store;
};

const IGNIS = indexOf({
  chunks: [
    chunk({
      id: 'wiki:guide.md#boot',
      document: 'guide.md',
      body: 'The kernel boots the flywheel.',
    }),
    chunk({ id: 'wiki:shared.md#x', document: 'shared.md', body: 'Shared words about flywheels.' }),
  ],
});
const ARDOR = indexOf({
  chunks: [
    chunk({
      id: 'wiki:admin.md#panel',
      document: 'admin.md',
      body: 'The admin panel spins a flywheel.',
    }),
    chunk({ id: 'wiki:shared.md#x', document: 'shared.md', body: 'Other shared words.' }),
  ],
});

describe('SourceChunks', () => {
  const chunks = new SourceChunks({
    sources: [
      { name: 'ignis', chunks: () => IGNIS },
      { name: 'ardor', chunks: () => ARDOR },
    ],
  });

  test('a search spans every source, and every hit names its source', () => {
    const { total, hits } = chunks.search({ query: 'flywheel', limit: 10, offset: 0 });

    expect(total).toBe(3);
    expect(hits.map(hit => `${hit.source} ${hit.id}`).sort()).toEqual([
      'ardor wiki:admin.md#panel',
      'ignis wiki:guide.md#boot',
      'ignis wiki:shared.md#x',
    ]);
  });

  test('paging slices the merged hits, not each source on its own', () => {
    const first = chunks.search({ query: 'flywheel', limit: 2, offset: 0 }).hits;
    const rest = chunks.search({ query: 'flywheel', limit: 2, offset: 2 }).hits;

    expect([...first, ...rest].map(hit => hit.id).sort()).toEqual([
      'wiki:admin.md#panel',
      'wiki:guide.md#boot',
      'wiki:shared.md#x',
    ]);
  });

  test('a search with a source answers from that source alone', () => {
    const { total, hits } = chunks.search({
      query: 'flywheel',
      source: 'ardor',
      limit: 10,
      offset: 0,
    });

    expect(total).toBe(1);
    expect(hits.map(hit => `${hit.source} ${hit.id}`)).toEqual(['ardor wiki:admin.md#panel']);
  });

  test('a search tool call with an unknown source is invalid params naming the known sources', async () => {
    const transport = new Transport({
      tools: [buildSearchTool({ store: chunks })],
      serverName: 'atlas-test',
      serverVersion: '0.0.0',
    });
    const reply = JSON.parse(
      (await transport.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'flywheel', source: 'bana' } },
        }),
      })) ?? 'null',
    );

    expect(reply.error?.code).toBe(RpcErrorCodes.INVALID_PARAMS);
    expect(reply.error?.message).toBe("unknown source 'bana'; known sources: ignis, ardor");
  });

  test('the search tool schema offers the source filter', () => {
    const { inputSchema } = buildSearchTool({ store: chunks }).definition;

    expect(inputSchema.properties).toHaveProperty('source');
  });

  test('an id one source holds needs no source; an id two hold asks for it', () => {
    expect(chunks.get({ id: 'wiki:admin.md#panel' })?.source).toBe('ardor');
    expect(() => chunks.get({ id: 'wiki:shared.md#x' })).toThrow(
      "id 'wiki:shared.md#x' is in more than one source (ignis, ardor) - pass source",
    );
    expect(chunks.get({ id: 'wiki:shared.md#x', source: 'ardor' })?.body).toBe(
      'Other shared words.',
    );
  });
});

const releasesOf = (opts: { dir: string; name: string; version: string }): ReleaseStore =>
  new ReleaseStore({
    table: {
      livePackages: [opts.dir],
      packageMap: [{ dir: opts.dir, name: opts.name, aliases: [] }],
      releases: {
        [opts.dir]: [{ version: opts.version, date: '2026-01-02', sha: 'aaaaaaaa', order: 1 }],
      },
      changelogs: [
        {
          id: `changelog:2026-01-02-${opts.dir}`,
          file: 'x.md',
          date: '2026-01-02',
          title: 'x',
          packages: [opts.dir],
          kind: null,
          order: 1,
        },
      ],
    },
  });

describe('SourceReleases', () => {
  const releases = new SourceReleases({
    sources: [
      {
        name: 'ignis',
        releases: releasesOf({ dir: 'kernel', name: '@venizia/ignis-kernel', version: '0.2.0' }),
      },
      {
        name: 'ardor',
        releases: releasesOf({ dir: 'kernel', name: '@venizia/ardor-kernel', version: '0.1.0' }),
      },
    ],
  });

  test('a npm name routes to the source that releases it', () => {
    expect(releases.versionsOf({ package: '@venizia/ardor-kernel' })).toEqual(['0.1.0']);
    expect(releases.packageOf({ package: '@venizia/ignis-kernel' })).toBe('@venizia/ignis-kernel');
  });

  test('a directory two sources share is ambiguous, and the error names the npm names', () => {
    expect(() => releases.versionsOf({ package: 'kernel' })).toThrow(
      "'kernel' names a package in more than one source - ask by npm name: @venizia/ignis-kernel (ignis), @venizia/ardor-kernel (ardor)",
    );
  });

  test('an ambiguous package reaches the client as invalid params, not an internal error', async () => {
    const transport = new Transport({
      tools: [buildChangesTool({ releases })],
      serverName: 'atlas-test',
      serverVersion: '0.0.0',
    });
    const reply = JSON.parse(
      (await transport.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'changes', arguments: { package: 'kernel' } },
        }),
      })) ?? 'null',
    );

    expect(reply.error.code).toBe(RpcErrorCodes.INVALID_PARAMS);
    expect(reply.error.message).toContain(
      '@venizia/ignis-kernel (ignis), @venizia/ardor-kernel (ardor)',
    );
  });

  test('a date window spans every source, each entry naming its source', () => {
    const entries = releases.entriesBetween({ fromDate: '2026-01-01', toDate: '2026-01-03' });

    expect(entries.map(entry => `${entry.source} ${entry.id}`).sort()).toEqual([
      'ardor changelog:2026-01-02-kernel',
      'ignis changelog:2026-01-02-kernel',
    ]);
  });
});

describe('SourceSymbols', () => {
  test('records from every source, each naming its source', () => {
    const record = (opts: { pkg: string }) => ({
      name: 'boot',
      package: opts.pkg,
      subpath: '.',
      specifier: opts.pkg,
      kind: 'function',
      file: 'x.d.ts',
      line: 1,
      signature: 'boot(): void',
    });
    const symbols = new SourceSymbols({
      sources: [
        {
          name: 'ignis',
          symbols: new SymbolStore({ symbols: [record({ pkg: '@venizia/ignis-kernel' })] }),
        },
        {
          name: 'ardor',
          symbols: new SymbolStore({ symbols: [record({ pkg: '@venizia/ardor-kernel' })] }),
        },
      ],
    });

    expect(
      symbols.lookup({ name: 'boot' }).map(found => `${found.source} ${found.package}`),
    ).toEqual(['ignis @venizia/ignis-kernel', 'ardor @venizia/ardor-kernel']);
  });
});

describe('SourceReleases with a local project that has no release on this ref', () => {
  const local = new ReleaseStore({
    table: {
      livePackages: ['umbras-core'],
      packageMap: [{ dir: 'umbras-core', name: '@nx/core', aliases: ['apps/core'] }],
      releases: {},
      changelogs: [
        {
          id: 'changelog:2026-10-05-core',
          file: 'x.md',
          date: '2026-10-05',
          title: 'core',
          packages: ['umbras-core'],
          kind: null,
        },
      ],
    },
  });
  const releases = new SourceReleases({
    sources: [
      {
        name: 'ignis',
        releases: releasesOf({ dir: 'kernel', name: '@venizia/ignis-kernel', version: '0.2.0' }),
      },
      { name: 'bana', releases: local },
    ],
  });
  const ask = async (args: Record<string, unknown>) =>
    JSON.parse(
      (await new Transport({
        tools: [buildChangesTool({ releases })],
        serverName: 'atlas-test',
        serverVersion: '0.0.0',
      }).handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'changes', arguments: args },
        }),
      })) ?? 'null',
    );

  test('a declared package answers by npm name, directory key and alias - never "unknown package"', async () => {
    for (const name of ['@nx/core', 'umbras-core', 'apps/core']) {
      const reply = await ask({ package: name });

      expect(reply.error, name).toBeUndefined();

      const payload = JSON.parse(reply.result.content[0].text);

      expect(payload.package).toBe('@nx/core');
      expect(payload.note).toContain('no release of @nx/core is recorded on this ref');
      expect(payload.entries.map((found: { id: string }) => found.id)).toEqual([
        'changelog:2026-10-05-core',
      ]);
    }
  });

  test('a name no source declares is still unknown, naming the known packages', async () => {
    const reply = await ask({ package: '@nx/nope' });

    expect(reply.error.message).toContain("unknown package '@nx/nope'");
  });
});
