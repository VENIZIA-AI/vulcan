import { IGNIS_PACKAGE_MAP } from '../fixtures/ignis-packages';
import { AtlasConstants, Corpora } from '@/common';
import { Chunker, CorpusLoader } from '@/corpus';
import { Transport } from '@/protocol';
import { ChunkStore } from '@/search/store';
import { SymbolStore } from '@/symbols';
import type { ISymbolRecord } from '@/symbols';
import { SymbolTool } from '@/tools/symbol.tool';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

// __dirname, not import.meta: this package emits CommonJS.
const FIXTURES_ROOT = join(__dirname, '../fixtures/corpus');

const record = (opts: Partial<ISymbolRecord> & { name: string }): ISymbolRecord => ({
  package: '@venizia/ignis-helpers',
  subpath: '.',
  specifier: '@venizia/ignis-helpers',
  kind: 'function',
  file: 'packages/helpers/src/modules/error/error.ts',
  line: 42,
  signature: `${opts.name}(): void`,
  ...opts,
});

const SYMBOLS: ISymbolRecord[] = [
  record({ name: 'getError' }),
  record({ name: 'respond', package: '@venizia/ignis', specifier: '@venizia/ignis' }),
  record({ name: 'respond', package: '@venizia/ignis-kernel', specifier: '@venizia/ignis-kernel' }),
  record({ name: 'respondError' }),
];

const buildChunkStore = (): ChunkStore => {
  const documents = CorpusLoader.getInstance().load({
    roots: [
      { corpus: Corpora.WIKI, directory: join(FIXTURES_ROOT, 'wiki'), exclude: ['excluded'] },
      { corpus: Corpora.CHANGELOG, directory: join(FIXTURES_ROOT, 'changelogs') },
      { corpus: Corpora.KNOWLEDGE, directory: join(FIXTURES_ROOT, 'knowledge') },
    ],
  });

  const chunker = Chunker.getInstance();
  const store = new ChunkStore();

  store.add({ chunks: documents.flatMap((document) => chunker.chunk({ document })) });

  return store;
};

const callSymbol = async (opts: {
  symbols: SymbolStore;
  args: Record<string, unknown>;
}): Promise<{
  error?: { code: number; message: string };
  result?: { content: { type: string; text: string }[] };
}> => {
  const transport = new Transport({
    tools: [SymbolTool.build({ store: buildChunkStore(), symbols: opts.symbols })],
    serverName: 'atlas-test',
    serverVersion: '0.0.0',
  });
  const reply = await transport.handleLine({
    line: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'symbol', arguments: opts.args },
    }),
  });

  return JSON.parse(reply ?? 'null');
};

const payloadOf = (reply: { result?: { content: { text: string }[] } }) =>
  JSON.parse(reply.result?.content[0]?.text ?? '{}');

describe('symbol tool', () => {
  const symbols = new SymbolStore({ symbols: SYMBOLS, packageMap: IGNIS_PACKAGE_MAP });

  test('an empty name is -32602 with a message naming the field', async () => {
    const reply = await callSymbol({ symbols, args: { name: '' } });

    expect(reply.error?.code).toBe(-32602);
    expect(reply.error?.message).toContain('name');
  });

  test('a hit answers with the record and its doc citations, inside the search budget', async () => {
    const reply = await callSymbol({ symbols, args: { name: 'getError' } });
    const payload = payloadOf(reply);

    expect(payload.name).toBe('getError');
    expect(payload.package).toBe('@venizia/ignis-helpers');
    expect(payload.subpath).toBe('.');
    expect(payload.specifier).toBe('@venizia/ignis-helpers');
    expect(payload.kind).toBe('function');
    expect(payload.file).toBe('packages/helpers/src/modules/error/error.ts');
    expect(payload.line).toBe(42);
    expect(payload.signature).toBe('getError(): void');
    expect(Array.isArray(payload.docs)).toBe(true);
    expect(payload.docs.length).toBeLessThanOrEqual(5);
    expect(reply.result?.content[0]?.text.length).toBeLessThanOrEqual(
      AtlasConstants.SEARCH_BUDGET_CHARS,
    );
  });

  test('a name in two packages answers with every match', async () => {
    const result = await callSymbol({ symbols, args: { name: 'respond' } });
    const payload = payloadOf(result);

    expect(payload.matches).toHaveLength(2);
    expect(payload.matches.map((match: ISymbolRecord) => match.package).sort()).toEqual([
      '@venizia/ignis',
      '@venizia/ignis-kernel',
    ]);
  });

  test('a package filter narrows an ambiguous name back to one record', async () => {
    const result = await callSymbol({ symbols, args: { name: 'respond', package: 'kernel' } });
    const payload = payloadOf(result);

    expect(payload.matches).toBeUndefined();
    expect(payload.package).toBe('@venizia/ignis-kernel');
  });

  test('an unknown name is a result, not an error: no matches, and the closest known names', async () => {
    const reply = await callSymbol({ symbols, args: { name: 'respnd' } });

    expect(reply.error).toBeUndefined();
    expect(payloadOf(reply)).toEqual({ name: 'respnd', matches: [], closest: ['respond'] });
  });

  test('an unknown name with no close candidate still answers, with an empty closest list', async () => {
    const reply = await callSymbol({ symbols, args: { name: 'zzzzzzzzzzz' } });

    expect(reply.error).toBeUndefined();
    expect(payloadOf(reply)).toEqual({ name: 'zzzzzzzzzzz', matches: [], closest: [] });
  });

  test('a package filter that rules out every match answers the same way', async () => {
    const reply = await callSymbol({ symbols, args: { name: 'getError', package: 'kernel' } });

    expect(reply.error).toBeUndefined();
    expect(payloadOf(reply).matches).toEqual([]);
  });

  test('a name exported from nine specifiers still answers inside the budget', async () => {
    const crowded = new SymbolStore({
      symbols: Array.from({ length: 9 }, (_unused, index) =>
        record({
          name: 'AbstractSearchController',
          subpath: `./search/controllers/level-${index}`,
          specifier: `@venizia/ignis-connectors/search/controllers/level-${index}`,
          kind: 'class',
          file: 'packages/connectors/src/search/core/controllers/abstract.controller.ts',
          signature: `class AbstractSearchController${'X'.repeat(260)}`,
        }),
      ),
    });

    const reply = await callSymbol({
      symbols: crowded,
      args: { name: 'AbstractSearchController' },
    });
    const payload = payloadOf(reply);

    expect(reply.result?.content[0]?.text.length).toBeLessThanOrEqual(
      AtlasConstants.SEARCH_BUDGET_CHARS,
    );
    expect(payload.matches.length).toBeGreaterThan(0);
    expect(payload.matches.length).toBeLessThan(9);
  });

  test('a build with no symbol table says so instead of guessing', async () => {
    const reply = await callSymbol({
      symbols: new SymbolStore({ symbols: [] }),
      args: { name: 'getError' },
    });

    expect(reply.error?.code).toBe(-32602);
    expect(reply.error?.message).toBe('no symbol table in this build');
  });
});

describe('symbol tool: the declaration', () => {
  const withText = (opts: Partial<ISymbolRecord> & { name: string }): ISymbolRecord =>
    record({ shape: `shape-${opts.name}`, declaration: `declare ${opts.name};`, ...opts });

  const serve = (opts: { records: ISymbolRecord[]; name: string }) =>
    callSymbol({
      symbols: new SymbolStore({ symbols: opts.records, packageMap: IGNIS_PACKAGE_MAP }),
      args: { name: opts.name },
    }).then(payloadOf);

  test('a record without a declaration answers as before', async () => {
    const payload = await serve({ records: [record({ name: 'plain' })], name: 'plain' });

    expect(payload.declaration).toBeUndefined();
    expect(payload.doc).toBeUndefined();
    expect(payload.uses).toBeUndefined();
  });

  test('the declaration is served outside the budget of the rest, and `uses` is not', async () => {
    const payload = await serve({
      records: [
        withText({ name: 'big', declaration: `/** Big. */\n${'x'.repeat(3000)}`, uses: ['B'] }),
      ],
      name: 'big',
    });

    expect(payload.declaration.startsWith('/** Big. */')).toBe(true);
    expect(payload.uses).toBeUndefined();
    expect(payload.truncated).toBeUndefined();
  });

  test('the declarations it uses follow, nearest first, small before large, each named', async () => {
    const records = [
      withText({ name: 'Root', uses: ['Large', 'Small'] }),
      withText({ name: 'Large', declaration: `declare Large;${' '.repeat(500)}` }),
      withText({ name: 'Small', uses: ['Deep'] }),
      withText({ name: 'Deep' }),
    ];
    const { declaration } = await serve({ records, name: 'Root' });

    expect(declaration.indexOf('declare Root;')).toBe(0);
    expect(declaration.indexOf('// Small')).toBeLessThan(declaration.indexOf('// Large'));
    expect(declaration).toContain('// Deep (@venizia/ignis-helpers)\ndeclare Deep;');
  });

  test('a used declaration follows only three steps from the asked one', async () => {
    const records = ['A', 'B', 'C', 'D', 'E'].map((name, at, all) =>
      withText({ name, uses: all[at + 1] === undefined ? [] : [all[at + 1]] }),
    );
    const { declaration } = await serve({ records, name: 'A' });

    expect(declaration).toContain('// D ');
    expect(declaration).not.toContain('// E ');
  });

  test('what does not fit the budget is left out and the reply says so', async () => {
    const records = [
      withText({ name: 'Root', uses: ['Huge', 'Fits'] }),
      withText({ name: 'Huge', declaration: 'h'.repeat(12_000) }),
      withText({ name: 'Fits' }),
    ];
    const payload = await serve({ records, name: 'Root' });

    expect(payload.declaration).toContain('// Fits');
    expect(payload.declaration).not.toContain('// Huge');
    expect(payload.truncated).toBe(true);
    expect(payload.declaration.length).toBeLessThanOrEqual(10_000);
  });

  test('a declaration a few characters over the budget is cut, inside the budget, and says so', async () => {
    const lines = Array.from({ length: 1000 }, () => 'abcdefghij;').join('\n');
    const payload = await serve({
      records: [withText({ name: 'Edge', declaration: `${lines.slice(0, 10_005)}` })],
      name: 'Edge',
    });

    expect(payload.truncated).toBe(true);
    expect(payload.declaration.length).toBeLessThanOrEqual(10_000);
  });

  test('a used declaration already shown with an earlier block adds no empty header', async () => {
    const records = [
      withText({ name: 'Root', declaration: 'shared paragraph\n\nroot', uses: ['Twin'] }),
      withText({ name: 'Twin', declaration: 'shared paragraph' }),
    ];
    const { declaration } = await serve({ records, name: 'Root' });

    expect(declaration).not.toContain('// Twin');
  });

  test('an own declaration over the budget is cut at a line and marked', async () => {
    const lines = Array.from({ length: 2000 }, (_, at) => `member${at}: string;`).join('\n');
    const payload = await serve({
      records: [withText({ name: 'Wide', declaration: lines })],
      name: 'Wide',
    });

    expect(payload.truncated).toBe(true);
    expect(payload.declaration.endsWith('// ... cut')).toBe(true);
    expect(payload.declaration.length).toBeLessThanOrEqual(10_000 + 20);
  });

  test('a name exported by two packages with one shape is spelled out once', async () => {
    const records = [
      withText({
        name: 'Both',
        shape: 'same',
        package: '@venizia/ignis',
        specifier: '@venizia/ignis',
      }),
      withText({
        name: 'Both',
        shape: 'same',
        package: '@venizia/ignis-kernel',
        specifier: '@venizia/ignis-kernel',
      }),
    ];
    const payload = await serve({ records, name: 'Both' });
    const [first, second] = payload.matches;

    expect(first.declaration).toContain('declare Both;');
    expect(second.declaration).toBeUndefined();
    expect(second.declarationOf).toBe(first.specifier);
  });
});
