import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicSurface } from '@/surface';

const tmpDirs: string[] = [];

const SURFACE_BASE = [
  'export declare class A {}',
  'export interface B {',
  '  x: number;',
  '}',
  'export declare const c: number;',
];

const makeRepoRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ignis-public-surface-'));

  tmpDirs.push(root);
  const packageDir = join(root, 'packages', 'testpkg');

  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: '@test/testpkg', exports: { '.': { types: './index.d.ts' } } }),
  );

  return root;
};

const writeSurface = (opts: { repoRoot: string; extraLines?: string[] }): void => {
  const body = [...SURFACE_BASE, ...(opts.extraLines ?? []), ''].join('\n');

  writeFileSync(join(opts.repoRoot, 'packages', 'testpkg', 'index.d.ts'), body);
};

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('PublicSurface.render', () => {
  test('a css export next to the typed entry is skipped, never parsed as a declaration file', () => {
    const repoRoot = makeRepoRoot();

    writeSurface({ repoRoot });
    const packageDir = join(repoRoot, 'packages', 'testpkg');

    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@test/testpkg',
        exports: { '.': { types: './index.d.ts' }, './styles.css': './styles.css' },
      }),
    );
    writeFileSync(join(packageDir, 'styles.css'), '.a { color: red; }\n');

    const rendered = PublicSurface.render({ repoRoot, packages: ['testpkg'] });

    expect(rendered).toContain('`@test/testpkg` (3)');
    expect(rendered).not.toContain('styles.css');
  });

  test('lists an exported class, interface and const with their kinds', () => {
    const repoRoot = makeRepoRoot();

    writeSurface({ repoRoot });

    const rendered = PublicSurface.render({ repoRoot, packages: ['testpkg'] });

    expect(rendered).toContain('- `A` class');
    expect(rendered).toContain('- `B` interface');
    expect(rendered).toContain('- `c` const');
  });
});

describe('the package list', () => {
  test('without atlas.packages in the project config, render stops with what to add', () => {
    const repoRoot = makeRepoRoot();

    expect(() => PublicSurface.render({ repoRoot })).toThrow(
      '[atlas] no .configs/vulcan.config.* in',
    );
  });

  test('render reads the directories from atlas.packages', () => {
    const repoRoot = makeRepoRoot();
    writeSurface({ repoRoot });
    mkdirSync(join(repoRoot, '.configs'));
    writeFileSync(
      join(repoRoot, '.configs', 'vulcan.config.ts'),
      "export default { atlas: { packages: { testpkg: '@test/testpkg' } } };\n",
    );

    expect(PublicSurface.render({ repoRoot })).toContain('`@test/testpkg` (3)');
  });
});

describe('PublicSurface.check', () => {
  test('is fresh right after a snapshot, and stale once an export is added', () => {
    const repoRoot = makeRepoRoot();
    const outputPath = join(repoRoot, 'public-surface.md');

    writeSurface({ repoRoot });
    writeFileSync(outputPath, PublicSurface.render({ repoRoot, packages: ['testpkg'] }));

    expect(PublicSurface.check({ repoRoot, packages: ['testpkg'], outputPath })).toBe(true);

    writeSurface({ repoRoot, extraLines: ['export declare const d: number;'] });

    expect(PublicSurface.check({ repoRoot, packages: ['testpkg'], outputPath })).toBe(false);
  });
});
