import { describe, expect, test } from 'bun:test';
import { Transport } from '@/protocol';
import { SymbolIntent, SymbolStore } from '@/symbols';
import type { ISymbolRecord } from '@/symbols';
import { IntentTool } from '@/tools/intent.tool';

const record = (opts: Partial<ISymbolRecord> & { name: string }): ISymbolRecord => ({
  package: '@venizia/ardor-react',
  subpath: '.',
  specifier: '@venizia/ardor-react',
  kind: 'function',
  file: 'packages/react/src/hooks/x.ts',
  line: 7,
  signature: `${opts.name}(): void`,
  ...opts,
});

const MEDIA = [
  'Tracks a CSS media query.',
  '',
  '@useWhen a component must react to a media query or a screen size',
  '  without its own listener',
  '@insteadOf window.matchMedia with addEventListener in a useEffect',
  '@example',
  "const isWide = useMediaQuery('(min-width: 800px)');",
].join('\n');

const SYMBOLS: ISymbolRecord[] = [
  record({ name: 'useMediaQuery', doc: MEDIA }),
  record({
    name: 'useDebounce',
    doc: 'Delays a value.\n\n@useWhen you must wait a fixed time before reacting to fast input\n@insteadOf setTimeout and clearTimeout inside a useEffect',
  }),
  record({ name: 'formatDate', kind: 'type', doc: 'Formats a date for display.' }),
  record({ name: 'Plain' }),
];

const call = async (args: Record<string, unknown>, symbols = SYMBOLS) => {
  const transport = new Transport({
    tools: [IntentTool.build({ symbols: new SymbolStore({ symbols }) })],
    serverName: 'atlas-test',
    serverVersion: '0.0.0',
  });
  const reply = await transport.handleLine({
    line: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'intent', arguments: args },
    }),
  });
  const parsed = JSON.parse(reply ?? 'null');

  return parsed.error === undefined ? JSON.parse(parsed.result.content[0].text) : parsed;
};

describe('SymbolIntent.tagsOf', () => {
  test('reads a tag across lines, the first example verbatim, and nothing from an untagged doc', () => {
    const tags = SymbolIntent.tagsOf({ doc: MEDIA });

    expect(tags.useWhen).toBe(
      'a component must react to a media query or a screen size without its own listener',
    );
    expect(tags.insteadOf).toBe('window.matchMedia with addEventListener in a useEffect');
    expect(tags.example).toBe("const isWide = useMediaQuery('(min-width: 800px)');");
    expect(SymbolIntent.tagsOf({ doc: 'Only prose.' })).toEqual({});
    expect(SymbolIntent.tagsOf({})).toEqual({});
  });

  test('joins repeated @useWhen lines and keeps only the first @example', () => {
    const tags = SymbolIntent.tagsOf({
      doc: '@useWhen one\n@useWhen two\n@example\nfirst\n@example\nsecond',
    });

    expect(tags.useWhen).toBe('one two');
    expect(tags.example).toBe('first');
  });
});

describe('the intent tool', () => {
  test('a need in plain words names the export, with its import line and what it replaces', async () => {
    const answer = await call({ query: 'I need to react to a screen size media query' });

    expect(answer.hits[0].name).toBe('useMediaQuery');
    expect(answer.hits[0].import).toBe("import { useMediaQuery } from '@venizia/ardor-react';");
    expect(answer.hits[0].insteadOf).toContain('matchMedia');
    expect(answer.hits[0].example).toContain('useMediaQuery(');
    expect(answer.hits[0].file).toBe('packages/react/src/hooks/x.ts');
  });

  test('useWhen outranks the prose, and a different need picks a different export', async () => {
    const answer = await call({ query: 'wait a fixed time before reacting' });

    expect(answer.hits[0].name).toBe('useDebounce');
  });

  test('a symbol with no tags is still found by its name; a type gets an import type line', async () => {
    const answer = await call({ query: 'format date' });

    expect(answer.hits[0].name).toBe('formatDate');
    expect(answer.hits[0].import).toBe("import type { formatDate } from '@venizia/ardor-react';");
  });

  test('a miss says so and names the closest by name, never a guess', async () => {
    const answer = await call({ query: 'quantum teleportation' });

    expect(answer.hits).toEqual([]);
    expect(Array.isArray(answer.closest)).toBe(true);
  });

  test('limit, package and source narrow; an empty table is an error naming why', async () => {
    const result = await call({ query: 'media query date wait', limit: 1 });
    expect(result.hits).toHaveLength(1);
    const result2 = await call({ query: 'media query', package: '@other/pkg' });
    expect(result2.hits).toEqual([]);

    const empty = await call({ query: 'media' }, []);

    expect(empty.error.message).toContain('no symbol table');
  });

  test('a package that is not installed is marked, so the install is not forgotten', async () => {
    const answer = await call({ query: 'media query' }, [
      record({ name: 'useMediaQuery', doc: MEDIA, origin: { version: '1.0.0' } }),
    ]);

    expect(answer.hits[0].notInstalled).toBe(true);
  });

  test('over the budget the example goes first, then trailing hits, and one hit always stays', async () => {
    const long = 'x'.repeat(900);
    const many = Array.from({ length: 6 }, (_, at) =>
      record({ name: `useThing${at}`, doc: `@useWhen thing\n@example\n${long}` }),
    );
    const answer = await call({ query: 'thing', limit: 6 }, many);
    const text = JSON.stringify(answer.hits);

    expect(text.length).toBeLessThanOrEqual(2000);
    expect(answer.hits.length).toBeGreaterThanOrEqual(1);
  });
});
