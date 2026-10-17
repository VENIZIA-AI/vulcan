import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtlasSymbols } from '@/symbols/generator';
import { IGNIS_IS_BUILT, IGNIS_ROOT } from '../ignis-root.helper';

const tmpDirs: string[] = [];

const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vulcan-atlas-symbols-'));

  tmpDirs.push(dir);

  return dir;
};

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('AtlasSymbols.sourcePathOf', () => {
  test('maps a dist/cjs declaration back to its source file', () => {
    expect(
      AtlasSymbols.sourcePathOf({ distPath: 'packages/helpers/dist/cjs/modules/base.d.ts' }),
    ).toBe('packages/helpers/src/modules/base.ts');
  });

  test('maps a dist/esm declaration back to the same source file', () => {
    expect(
      AtlasSymbols.sourcePathOf({ distPath: 'packages/helpers/dist/esm/modules/base.d.ts' }),
    ).toBe('packages/helpers/src/modules/base.ts');
  });

  test('maps a flat dist declaration back to its source file', () => {
    expect(AtlasSymbols.sourcePathOf({ distPath: 'packages/core-server/dist/index.d.ts' })).toBe(
      'packages/core-server/src/index.ts',
    );
  });

  test('leaves a path with no dist segment alone', () => {
    expect(AtlasSymbols.sourcePathOf({ distPath: 'node_modules/zod/index.d.ts' })).toBeUndefined();
  });
});

describe('AtlasSymbols.collapseSignature', () => {
  test('collapses a multi-line declaration onto one line', () => {
    const collapsed = AtlasSymbols.collapseSignature({
      text: 'getError(opts: {\n  message: string;\n}): ApplicationError',
    });

    expect(collapsed).toBe('getError(opts: { message: string; }): ApplicationError');
  });

  test('strips the export and declare modifiers and the trailing semicolon', () => {
    expect(AtlasSymbols.collapseSignature({ text: 'export declare const answer: number;' })).toBe(
      'const answer: number',
    );
  });

  test('caps the signature at 300 characters', () => {
    const collapsed = AtlasSymbols.collapseSignature({ text: 'x'.repeat(500) });

    expect(collapsed.length).toBe(300);
  });
});

const IGNIS_SYMBOLS = join(IGNIS_ROOT, '.agents/knowledge/reference/symbols.json');
const hasGeneratedTable = existsSync(IGNIS_SYMBOLS);

// Reading every package's .d.ts takes tens of seconds; the drift case below renders one small
// package instead, so only the freshness test pays for the whole surface.
const WHOLE_SURFACE_TIMEOUT_MS = 300_000;
const ONE_PACKAGE_TIMEOUT_MS = 60_000;

describe.skipIf(!hasGeneratedTable || !IGNIS_IS_BUILT)('AtlasSymbols.check', () => {
  test(
    'reproduces every symbol of the committed table, and maps each package to its npm name',
    () => {
      // The table is read from dist, so a rebuild since the last `gen` differs here too. Content,
      // not bytes: 0.2.0-0 adds `packageMap`, which IGNIS's committed table predates.
      const table = JSON.parse(readFileSync(IGNIS_SYMBOLS, 'utf8'));
      const committed = Object.fromEntries(
        Object.entries(table).filter(([key]) => key !== 'packageMap'),
      );
      const { packageMap, ...rendered } = JSON.parse(
        AtlasSymbols.render({ repoRoot: IGNIS_ROOT, packages: table.packages }),
      );

      expect(rendered, 'stale symbol table - run `make symbols-gen`').toEqual(committed);
      expect(packageMap.find((entry: { dir: string }) => entry.dir === 'core-server')?.name).toBe(
        '@venizia/ignis',
      );
    },
    WHOLE_SURFACE_TIMEOUT_MS,
  );

  test(
    'reads stale once a symbol is dropped from the table',
    () => {
      const packages = ['inversion'];
      const outputPath = join(makeTmpDir(), 'symbols.json');

      writeFileSync(outputPath, AtlasSymbols.render({ repoRoot: IGNIS_ROOT, packages }));
      expect(AtlasSymbols.check({ repoRoot: IGNIS_ROOT, packages, outputPath })).toBe(true);

      const table = JSON.parse(readFileSync(outputPath, 'utf8'));

      table.symbols = table.symbols.slice(1);
      writeFileSync(outputPath, `${JSON.stringify(table, null, 2)}\n`);

      expect(AtlasSymbols.check({ repoRoot: IGNIS_ROOT, packages, outputPath })).toBe(false);
    },
    ONE_PACKAGE_TIMEOUT_MS,
  );
});
