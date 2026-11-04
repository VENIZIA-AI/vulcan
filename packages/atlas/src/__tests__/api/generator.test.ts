import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiReference } from '@/api';
import type { ISymbolRecord } from '@/symbols';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const record = (opts: Partial<ISymbolRecord> & { name: string }): ISymbolRecord => ({
  package: '@x/kit',
  subpath: '.',
  specifier: '@x/kit',
  kind: 'function',
  file: 'packages/kit/src/index.ts',
  line: 3,
  signature: `${opts.name}(): void`,
  doc: '',
  declaration: `export declare function ${opts.name}(): void;`,
  ...opts,
});

describe('ApiReference.filesOf', () => {
  const records = [
    record({
      name: 'zeta',
      doc: 'The last one.',
      declaration: '/** The last one. */\nexport declare function zeta(): void;',
    }),
    record({ name: 'alpha' }),
    record({ name: 'run', specifier: '@x/kit/testing', subpath: './testing', doc: 'Runs.' }),
  ];
  const files = ApiReference.filesOf({ records });

  test('one page for each entry, plus an index', () => {
    expect([...files.keys()].sort()).toEqual(['index.md', 'x-kit-testing.md', 'x-kit.md']);
  });

  test('a page lists the exports by name, with kind, TSDoc and the declaration without its leading comment', () => {
    const page = files.get('x-kit.md') ?? '';

    expect(page.indexOf('## `alpha`')).toBeLessThan(page.indexOf('## `zeta`'));
    expect(page).toContain('*function*');
    expect(page).toContain('The last one.\n');
    expect(page).toContain('```ts\nexport declare function zeta(): void;\n```');
    expect(page).not.toContain('/** The last one. */');
    expect(page).toContain('Source: `packages/kit/src/index.ts:3`');
  });

  test('the exports without TSDoc are counted and named at the top', () => {
    const page = files.get('x-kit.md') ?? '';

    expect(page).toContain('2 exports, 1 with TSDoc.');
    expect(page).toContain('Without TSDoc (1): `alpha`.');
  });

  test('the index links each page with its counts', () => {
    const index = files.get('index.md') ?? '';

    expect(index).toContain('| [`@x/kit`](/references/api/x-kit) | 2 | 1 |');
    expect(index).toContain('| [`@x/kit/testing`](/references/api/x-kit-testing) | 1 | 1 |');
  });

  test('a re-export of a third-party declaration shows its signature, no source path, and is not counted undocumented', () => {
    const page =
      ApiReference.filesOf({
        records: [record({ name: 'z', external: true, declaration: undefined, doc: undefined })],
      }).get('x-kit.md') ?? '';

    expect(page).toContain('z(): void');
    expect(page).not.toContain('Source:');
    expect(page).not.toContain('Without TSDoc');
  });
});

describe('ApiReference.isInternal', () => {
  test('an export whose TSDoc says @internal is left out of its page and its counts', () => {
    const files = ApiReference.filesOf({
      records: [
        record({ name: 'shown', doc: 'Public.' }),
        record({ name: 'hidden', doc: '@internal' }),
        record({ name: 'alsoHidden', doc: 'Used by the tests.\n\n@internal' }),
      ],
    });
    const page = files.get('x-kit.md') ?? '';

    expect(page).toContain('## `shown`');
    expect(page).not.toContain('hidden');
    expect(page).not.toContain('alsoHidden');
    expect(page).toContain('1 exports, 1 with TSDoc.');
  });

  test('a word that only contains the tag is not the tag', () => {
    expect(
      ApiReference.isInternal({ record: record({ name: 'x', doc: 'See user@internal.example.' }) }),
    ).toBe(false);
  });
});

describe('ApiReference.proseOf', () => {
  test('markup the comment did not mean is escaped outside code', () => {
    expect(ApiReference.proseOf({ text: 'A <Entity> and {{ x }}.' })).toBe(
      'A &lt;Entity> and &#123;&#123; x }}.',
    );
  });

  test('inline code and fenced examples are left alone', () => {
    const text = 'Use `Promise<T>` here.\n```ts\nconst a = <T,>(x: T) => x;\n```\nThen <b>.';

    expect(ApiReference.proseOf({ text })).toBe(
      'Use `Promise<T>` here.\n```ts\nconst a = <T,>(x: T) => x;\n```\nThen &lt;b>.',
    );
  });
});

describe('ApiReference.fenceOf', () => {
  test('is three backticks, or one more than the longest run in the text', () => {
    expect(ApiReference.fenceOf({ text: 'plain' })).toBe('```');
    expect(ApiReference.fenceOf({ text: 'a ```` b' })).toBe('`````');
  });

  test('a declaration whose member comment holds a fence is wrapped in a longer one', () => {
    const declaration =
      'export declare class F {\n    /** ```ts\n    x\n    ``` */\n    m(): void;\n}';
    const page =
      ApiReference.filesOf({ records: [record({ name: 'F', declaration })] }).get('x-kit.md') ?? '';

    expect(page).toContain('````ts');
  });
});

describe('ApiReference.staleOf', () => {
  const directory = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-api-'));

    roots.push(root);
    mkdirSync(join(root, 'api'));

    return join(root, 'api');
  };
  const expected = new Map([
    ['a.md', 'one'],
    ['index.md', 'two'],
  ]);

  test('fresh when every file is there and equal and nothing else is', () => {
    const dir = directory();

    writeFileSync(join(dir, 'a.md'), 'one');
    writeFileSync(join(dir, 'index.md'), 'two');

    expect(ApiReference.staleOf({ expected, directory: dir })).toEqual([]);
  });

  test('names a missing file, a changed one and one that is no longer generated', () => {
    const dir = directory();

    writeFileSync(join(dir, 'a.md'), 'changed');
    writeFileSync(join(dir, 'gone.md'), 'old');

    expect(ApiReference.staleOf({ expected, directory: dir })).toEqual([
      'a.md',
      'gone.md',
      'index.md',
    ]);
  });

  test('a directory that does not exist yet is all missing', () => {
    expect(ApiReference.staleOf({ expected, directory: join(directory(), 'absent') })).toEqual([
      'a.md',
      'index.md',
    ]);
  });
});
