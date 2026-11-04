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
