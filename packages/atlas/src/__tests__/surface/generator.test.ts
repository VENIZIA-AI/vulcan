import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicSurface } from '@/surface';
import { clearAtlasProject, useAtlasProject } from '../project.helper';

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

  test('the page says it is generated, so okf gen leaves it whole - no contents list written into it', () => {
    const repoRoot = makeRepoRoot();

    writeSurface({ repoRoot });

    const rendered = PublicSurface.render({ repoRoot, packages: ['testpkg'] });
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(rendered)?.[1] ?? '';

    expect(frontmatter).toContain('generated:\n  by: atlas-surface');
  });
});

describe('the package list', () => {
  afterEach(clearAtlasProject);

  test('no manifest, render stops with what to do', () => {
    expect(() => PublicSurface.render({ repoRoot: makeRepoRoot() })).toThrow(
      'atlas: no project manifest (.agents/vulcan.manifest.json) - run `vulcan sync`',
    );
  });

  test('render walks the live packages; a retired one with no directory is skipped, not read', () => {
    const repoRoot = makeRepoRoot();

    writeSurface({ repoRoot });
    useAtlasProject({
      root: repoRoot,
      manifest: {
        packages: [
          { dir: 'testpkg', name: '@test/testpkg', aliases: [], retired: false },
          { dir: 'ui-kit', name: '@test/ui-kit', aliases: [], retired: true },
        ],
      },
    });

    expect(PublicSurface.render({})).toContain('`@test/testpkg` (3)');
  });

  test('only retired packages: nothing to walk, and it says what to add', () => {
    useAtlasProject({
      root: makeRepoRoot(),
      manifest: { packages: [{ dir: 'ui-kit', name: '@test/ui-kit', aliases: [], retired: true }] },
    });

    expect(() => PublicSurface.render({})).toThrow(
      'atlas: add packages to .configs/vulcan.config.ts',
    );
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
