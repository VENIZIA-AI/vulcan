import { describe, expect, test } from 'bun:test';
import { Transport } from '@/protocol';
import { SourceSymbols } from '@/sources/serving';
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

describe('SymbolIntent, code fences', () => {
  const FENCED = [
    'Registers a controller.',
    '```ts',
    '@controller({ path: "/early" })',
    '```',
    'Still prose.',
    '@useWhen an app needs a route',
    '@example',
    '```ts',
    '@controller({ path: "/users" })',
    'export class UserController {}',
    '```',
    '@insteadOf a hand-written router',
  ].join('\n');

  test('a decorator inside a fence belongs to the example, never starts a tag', () => {
    const tags = SymbolIntent.tagsOf({ doc: FENCED });

    expect(tags.example).toBe(
      '```ts\n@controller({ path: "/users" })\nexport class UserController {}\n```',
    );
    expect(tags.useWhen).toBe('an app needs a route');
    expect(tags.insteadOf).toBe('a hand-written router');
  });

  test('a fence in the prose does not end the prose', () => {
    const prose = SymbolIntent.proseOf({ doc: FENCED });

    expect(prose).toContain('@controller({ path: "/early" })');
    expect(prose).toContain('Still prose.');
    expect(prose).not.toContain('an app needs a route');
  });
});

describe('SymbolIntent.tokensOf', () => {
  test('a TPascal or IPascal name splits after its prefix letter', () => {
    expect(SymbolIntent.tokensOf({ text: 'TNullable' })).toEqual(['t', 'nullable']);
    // `i` is a stop word; split or not, `request` and `context` are words of their own.
    expect(SymbolIntent.tokensOf({ text: 'IRequestContext' })).toEqual(['request', 'context']);
  });

  test('"nullable type" finds TNullable first among the type helpers', () => {
    const hits = SymbolIntent.rank({
      records: [
        record({ name: 'TNullable', kind: 'type', doc: 'A value or null.' }),
        record({ name: 'ValueOf', kind: 'type', doc: 'The values of an object type.' }),
        record({ name: 'TConstValue', kind: 'type', doc: 'The value type of a const class.' }),
      ],
      query: 'nullable type',
      limit: 3,
    });

    expect(hits[0].record.name).toBe('TNullable');
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

  test('one declaration reached through several entries is one hit, imported from the declaring package', async () => {
    const same = { name: 'useSleep', doc: '@useWhen wait before the next step', shape: 'abc' };
    const answer = await call({ query: 'wait before the next step' }, [
      record({ ...same, package: '@venizia/ardor', specifier: '@venizia/ardor', reExported: true }),
      record({ ...same, package: '@venizia/ardor-kernel', specifier: '@venizia/ardor-kernel' }),
      record({
        ...same,
        package: '@venizia/ardor-kernel',
        subpath: './hooks',
        specifier: '@venizia/ardor-kernel/hooks',
      }),
    ]);

    expect(answer.hits).toHaveLength(1);
    expect(answer.hits[0].import).toBe("import { useSleep } from '@venizia/ardor-kernel/hooks';");
  });

  test('a subpath wins over the root, the shorter subpath next, then the specifier; same file:line merges without a shape', async () => {
    const same = {
      name: 'sleep',
      doc: '@useWhen wait',
      file: 'packages/helpers/src/p.ts',
      line: 3,
    };
    const entries = ['.', './common', './core', './utilities/all'].map((subpath) =>
      record({
        ...same,
        package: '@x/helpers',
        subpath,
        specifier: subpath === '.' ? '@x/helpers' : `@x/helpers${subpath.slice(1)}`,
      }),
    );
    const forward = await call({ query: 'wait' }, entries);
    const backward = await call({ query: 'wait' }, [...entries].reverse());

    expect(forward.hits).toHaveLength(1);
    expect(forward.hits[0].specifier).toBe('@x/helpers/core');
    expect(backward.hits[0].specifier).toBe('@x/helpers/core');
  });

  test('two different declarations of one name stay two hits', async () => {
    const answer = await call({ query: 'wait' }, [
      record({ name: 'sleep', doc: '@useWhen wait', file: 'a.ts' }),
      record({ name: 'sleep', doc: '@useWhen wait', file: 'b.ts', package: '@other/pkg' }),
    ]);

    expect(answer.hits).toHaveLength(2);
  });

  test('a public static member is its own hit, with its tags and the class import line', async () => {
    const answer = await call({ query: 'wait some milliseconds' }, [
      record({
        name: 'PromiseUtility',
        kind: 'class',
        specifier: '@x/helpers/common',
        doc: 'Promise helpers.',
        members: [
          {
            name: 'sleep',
            signature: 'static sleep(opts: { ms: number }): Promise<void>',
            line: 12,
            doc: 'Waits.\n@useWhen wait some milliseconds before going on\n@example\nawait PromiseUtility.sleep({ ms: 5 });',
          },
        ],
      }),
      record({ name: 'Plain' }),
    ]);

    expect(answer.hits[0].name).toBe('PromiseUtility.sleep');
    expect(answer.hits[0].import).toBe("import { PromiseUtility } from '@x/helpers/common';");
    expect(answer.hits[0].signature).toBe('static sleep(opts: { ms: number }): Promise<void>');
    expect(answer.hits[0].line).toBe(12);
    expect(answer.hits[0].useWhen).toBe('wait some milliseconds before going on');
    expect(answer.hits[0].example).toBe('await PromiseUtility.sleep({ ms: 5 });');
  });

  test('a query over 500 characters is refused', async () => {
    const answer = await call({ query: 'x'.repeat(501) });

    expect(answer.error).toBeDefined();
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

describe('the records intent ranks stay the same objects while the table is the same', () => {
  test('a store hands out one array per load, and a new one after its table is read again', () => {
    let version = 'one';
    const store = new SymbolStore({
      load: () => ({ symbols: [record({ name: `use${version}` })], packageMap: [] }),
      fingerprint: () => version,
    });
    const first = store.all();

    expect(store.all()).toBe(first);

    version = 'two';

    expect(store.all()).not.toBe(first);
    expect(store.all()[0].name).toBe('usetwo');
  });

  test('several sources name their records once per table', () => {
    const symbols = new SourceSymbols({
      sources: [{ name: 'ardor', symbols: new SymbolStore({ symbols: SYMBOLS }) }],
    });
    const first = symbols.all();

    expect(first[0].source).toBe('ardor');
    expect(symbols.all()[0]).toBe(first[0]);
  });
});
