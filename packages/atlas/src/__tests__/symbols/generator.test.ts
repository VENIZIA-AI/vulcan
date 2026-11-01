import { readAtlasProject } from '@/common/project-config';
import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasSymbols, runSymbolsCommand } from '@/symbols/generator';
import { IGNIS_IS_BUILT, IGNIS_ROOT } from '../ignis-root.helper';

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

// Reading every package's .d.ts takes tens of seconds, so only this test pays for the whole surface.
const WHOLE_SURFACE_TIMEOUT_MS = 300_000;

// No committed table to compare with since 0.2.0 (symbols are read when asked): this pins the
// renderer over IGNIS's real build instead.
describe.skipIf(!IGNIS_IS_BUILT || !existsSync(join(IGNIS_ROOT, '.agents/vulcan.manifest.json')))(
  'AtlasSymbols.render',
  () => {
    test(
      "renders IGNIS's live packages, each mapped to its npm name",
      () => {
        const packages = readAtlasProject({ root: IGNIS_ROOT })
          .packages.filter((entry) => !entry.retired)
          .map((entry) => entry.dir);
        const { packageMap, symbols } = JSON.parse(
          AtlasSymbols.render({ repoRoot: IGNIS_ROOT, packages }),
        );

        expect(symbols.length).toBeGreaterThan(0);
        expect(packageMap.find((entry: { dir: string }) => entry.dir === 'core-server')?.name).toBe(
          '@venizia/ignis',
        );
      },
      WHOLE_SURFACE_TIMEOUT_MS,
    );
  },
);

describe('runSymbolsCommand', () => {
  test('any subcommand prints the usage and exits 2', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(runSymbolsCommand({ command: 'gen' })).toBe(2);
      expect(error).toHaveBeenCalledWith('usage: vulcan x atlas symbols');
    } finally {
      error.mockRestore();
    }
  });
});
