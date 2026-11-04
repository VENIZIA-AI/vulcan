import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PackageEntries } from '@/common/package-entries';
import type { ISymbolRecord } from '@/symbols';
import { AtlasSymbols } from '@/symbols/generator';
import { DeclarationText } from '@/symbols/declaration-text';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A published package as npm unpacks it, with one declaration file that has each case the reader meets. */
const DECLARATIONS = [
  '/** Opens the door.',
  ' *',
  ' * Locks again after a minute. */',
  'export declare class Door {',
  '    /** The latch. */',
  '    latch: ILatch;',
  '    open(opts: { force: boolean }): Promise<Record<string, TOpened>>;',
  '}',
  '/** Not exported: only the door shows it. */',
  'interface ILatch {',
  '    held: boolean;',
  '}',
  'export type TOpened = "yes" | "no";',
  'export declare const a: number, b: string;',
  'export declare function plain(): void;',
  'export declare class Ids {',
  '    static readonly A = "a";',
  '}',
  'export type TId = (typeof Ids)[keyof typeof Ids];',
  'export declare function pick(id: TId): void;',
  'export * as ns from "./other.js";',
  'export {};',
  '',
].join('\n');

const recordsOfFixture = (): Map<string, ISymbolRecord> => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-declaration-text-'));

  roots.push(root);

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: '@x/doors',
      version: '1.0.0',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }),
    'dist/index.d.ts': DECLARATIONS,
    'dist/other.d.ts': '/** Documented elsewhere. */\nexport declare function inner(): void;\n',
  };

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  const records = AtlasSymbols.recordsOf({
    repoRoot: root,
    packages: [PackageEntries.readDirectory({ directory: root })],
  });

  return new Map(records.map((record) => [record.name, record]));
};

describe('the declaration a symbol record keeps', () => {
  const records = recordsOfFixture();
  const get = (name: string): ISymbolRecord => {
    const record = records.get(name);

    if (record === undefined) {
      throw new Error(`no record for ${name}`);
    }

    return record;
  };

  test('doc is the TSDoc of the export alone, without comment markers', () => {
    expect(get('Door').doc).toBe('Opens the door.\n\nLocks again after a minute.');
    expect(get('plain').doc).toBe('');
  });

  test('the declaration keeps the TSDoc and the members, with their own TSDoc', () => {
    const { declaration } = get('Door');

    expect(declaration).toContain('Opens the door.');
    expect(declaration).toContain('/** The latch. */');
    expect(declaration).toContain('open(opts: {');
  });

  test('an internal type the export uses travels with it; a lib type does not', () => {
    const { declaration, uses } = get('Door');

    expect(declaration).toContain('interface ILatch');
    expect(declaration).toContain('Not exported: only the door shows it.');
    expect(uses).toEqual(['TOpened']);
  });

  test('exported symbols it refers to are named, in order, never itself', () => {
    expect(get('pick').uses).toEqual(['TId']);
    expect(get('TId').uses).toEqual(['Ids']);
    expect(get('Door').uses).not.toContain('Door');
  });

  test('a module re-exported as a namespace has no declaration of its own, not the whole file', () => {
    expect(get('ns').declaration).toBeUndefined();
    expect(get('ns').doc).toBeUndefined();
  });

  test('a variable declared with another keeps its own declaration', () => {
    expect(get('a').declaration).toBe('export declare const a: number;');
    expect(get('b').declaration).toBe('export declare const b: string;');
  });
});

describe('DeclarationText.cut', () => {
  test('a text within the limit is returned whole', () => {
    expect(DeclarationText.cut({ text: 'a\nb', max: 10 })).toBe('a\nb');
  });

  test('the cut text and its mark fit in the limit', () => {
    const text = Array.from({ length: 50 }, () => 'abcdefghij').join('\n');

    expect(DeclarationText.cut({ text, max: 100 }).length).toBeLessThanOrEqual(100);
  });

  test('a longer text is cut at a line and marked', () => {
    const cut = DeclarationText.cut({ text: 'first line\nsecond line\nthird line here', max: 35 });

    expect(cut).toBe(`first line\nsecond line\n${DeclarationText.CUT_MARK}`);
  });
});

describe('DeclarationText.withoutDoc', () => {
  test('removes the leading TSDoc block and keeps the code', () => {
    const text = '/** One.\n * Two. */\nexport declare const a: number;';

    expect(DeclarationText.withoutDoc({ declaration: text })).toBe(
      'export declare const a: number;',
    );
  });

  test('a declaration with no TSDoc is unchanged', () => {
    expect(DeclarationText.withoutDoc({ declaration: 'export declare const a: number;' })).toBe(
      'export declare const a: number;',
    );
  });
});

describe('a package that publishes its TypeScript source', () => {
  const sourcePackage = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-source-package-'));

    roots.push(root);

    const files: Record<string, string> = {
      'package.json': JSON.stringify({
        name: '@x/src',
        version: '1.0.0',
        exports: { '.': './src/index.ts', './extra': { import: './src/extra.ts' } },
      }),
      'src/index.ts':
        "/** Adds two. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\nexport function bare(): string {\n  return 'x';\n}\nexport * from './more.ts';\n",
      'src/more.ts': '/** From another file. */\nexport const more = 1;\nexport class Undoc {}\n',
      'src/extra.ts': 'export const extra = 2;\n',
    };

    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    return root;
  };

  test('its entries are read only when asked, with the doc of each export and a signature, no body', () => {
    const root = sourcePackage();

    expect(PackageEntries.readDirectory({ directory: root }).entries).toEqual([]);

    const read = PackageEntries.readDirectory({ directory: root, withSource: true });

    expect(read.entries.map((entry) => entry.subpath)).toEqual(['.', './extra']);

    const records = new Map(
      AtlasSymbols.recordsOf({ repoRoot: root, packages: [read] }).map((record) => [
        `${record.specifier}:${record.name}`,
        record,
      ]),
    );

    expect(records.get('@x/src:add')?.doc).toBe('Adds two.');
    expect(records.get('@x/src:add')?.declaration).toContain('add(a: number, b: number): number');
    expect(records.get('@x/src:add')?.declaration).not.toContain('return a + b');
    expect(records.get('@x/src:bare')?.doc).toBe('');
    expect(records.get('@x/src:more')?.doc).toBe('From another file.');
    expect(records.get('@x/src:Undoc')?.doc).toBe('');
    expect(records.get('@x/src/extra:extra')?.doc).toBe('');
  });

  test('a .d.ts entry wins over a source entry of the same subpath', () => {
    expect(
      PackageEntries.sourceEntriesOf({
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      }),
    ).toEqual([]);
    expect(
      PackageEntries.sourceEntriesOf({
        exports: { '.': { types: './src/index.ts' }, './x': './src/x.d.ts', './json': './a.json' },
      }),
    ).toEqual([{ subpath: '.', types: './src/index.ts' }]);
  });
});
