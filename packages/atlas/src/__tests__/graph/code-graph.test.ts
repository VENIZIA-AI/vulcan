import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { ProjectConfig } from '@/common/project-config';
import { CodeGraph } from '@/graph/code-graph';
import type { ICodeGraph } from '@/graph/common/types';
import { GitState } from '@/graph/git-state';
import { ImportResolver } from '@/graph/import-resolver';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const CLI = join(__dirname, '..', '..', 'cli.ts');

const pkg = (name: string, extra: object = {}): string =>
  JSON.stringify({ name, version: '1.0.0', exports: { '.': './src/index.ts' }, ...extra });

const FILES: Record<string, string> = {
  'packages/a/package.json': pkg('@fx/a', {
    exports: { '.': './src/index.ts', './t': './types/t.d.ts' },
    dependencies: { '@fx/b': '1.0.0', zod: '4.0.0' },
  }),
  'packages/a/types/t.d.ts': 'export type Tt = 1;\n',
  'packages/a/src/lazy.ts': 'export const lazy = 1;\n',
  'packages/a/src/index.ts': [
    "import { b } from '@fx/b';",
    "import { util } from './util';",
    "import type { T } from './types/index';",
    "import { z } from 'zod';",
    "import { readFileSync } from 'node:fs';",
    "export * from './util.js';",
    "export const later = () => import('./lazy');",
    'export const a = [b, util, z, readFileSync];',
    '',
  ].join('\n'),
  'packages/a/src/util.ts': 'export const util = 1;\n',
  'packages/a/src/types/index.ts': 'export type T = 1;\n',
  'packages/b/package.json': pkg('@fx/b', {
    exports: { '.': './dist/esm/index.d.ts' },
    peerDependencies: { '@fx/a': '1.0.0' },
  }),
  'packages/b/src/index.ts': "import { util } from '@fx/a';\nexport const b = util;\n",
  'packages/c/package.json': pkg('@fx/c'),
  'packages/c/src/index.ts':
    "import { x } from '@/lib/x';\nimport { y } from '~/y';\nexport const c = [x, y];\n",
  'packages/c/src/lib/x.ts': 'export const x = 1;\n',
  'packages/c/src/skip/ignored.ts': "import { x } from '../lib/x';\nexport const i = x;\n",
  'packages/d/package.json': pkg('@fx/d'),
  'packages/d/src/index.ts': 'export const d = 1;\n',
  'packages/d/src/index.test.ts': "import { d } from './index';\nexport const t = d;\n",
  'packages/d/src/entry.test.ts': "import { d } from '@fx/d';\nexport const e = d;\n",
  'packages/d/src/__tests__/helper.ts': "import { d } from '../index';\nexport const h = d;\n",
};

const MANIFEST = {
  schemaVersion: 1,
  name: 'fx',
  packages: ['a', 'b', 'c', 'd'].map((dir) => ({
    name: `@fx/${dir}`,
    dir,
    path: `packages/${dir}`,
    aliases: [],
    retired: false,
  })),
  graph: { exclude: ['packages/c/src/skip/**'], aliases: { '@/': 'src/' } },
};

const git = (opts: { root: string; args: string[] }): void => {
  const result = spawnSyncBounded({ cmd: ['git', ...opts.args], cwd: opts.root, stdout: 'pipe' });

  expect(result.exitCode).toBe(0);
};

/** A git repository holding the fixture files and the manifest, committed. */
const repository = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-graph-'));

  roots.push(root);

  const all = { ...FILES, '.agents/vulcan.manifest.json': JSON.stringify(MANIFEST) };

  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  git({ root, args: ['init', '-q'] });
  git({ root, args: ['config', 'user.email', 'fx@example.com'] });
  git({ root, args: ['config', 'user.name', 'fx'] });
  git({ root, args: ['add', '-A'] });
  git({ root, args: ['commit', '-q', '-m', 'init'] });

  return root;
};

const buildOf = (opts: { root: string }): ICodeGraph => {
  const project = ProjectConfig.toAtlasProject({ root: opts.root, manifest: MANIFEST });
  const graph = CodeGraph.build({ root: opts.root, project });

  if (graph === undefined) {
    throw new Error('the fixture is a repository: git must list its files');
  }

  return graph;
};

const edgeList = (opts: { graph: ICodeGraph }): string[] =>
  opts.graph.edges.map((edge) => `${edge.kind} ${edge.from} -> ${edge.to}`);

describe('the code graph of a fixture repository', () => {
  const root = repository();
  const graph = buildOf({ root });

  test('has the packages, the entries and the tracked files, and not the excluded one', () => {
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'entry:@fx/a',
      'entry:@fx/a/t',
      'entry:@fx/b',
      'entry:@fx/c',
      'entry:@fx/d',
      'file:packages/a/src/index.ts',
      'file:packages/a/src/lazy.ts',
      'file:packages/a/src/types/index.ts',
      'file:packages/a/src/util.ts',
      'file:packages/a/types/t.d.ts',
      'file:packages/b/src/index.ts',
      'file:packages/c/src/index.ts',
      'file:packages/c/src/lib/x.ts',
      'file:packages/d/src/__tests__/helper.ts',
      'file:packages/d/src/entry.test.ts',
      'file:packages/d/src/index.test.ts',
      'file:packages/d/src/index.ts',
      'pkg:@fx/a',
      'pkg:@fx/b',
      'pkg:@fx/c',
      'pkg:@fx/d',
    ]);
  });

  test('has contains, depends (a cycle between a and b), imports and tested_by edges', () => {
    expect(edgeList({ graph })).toEqual([
      'contains entry:@fx/a -> file:packages/a/src/index.ts',
      'contains entry:@fx/a/t -> file:packages/a/types/t.d.ts',
      'contains entry:@fx/b -> file:packages/b/src/index.ts',
      'contains entry:@fx/c -> file:packages/c/src/index.ts',
      'contains entry:@fx/d -> file:packages/d/src/index.ts',
      'contains pkg:@fx/a -> entry:@fx/a',
      'contains pkg:@fx/a -> entry:@fx/a/t',
      'contains pkg:@fx/b -> entry:@fx/b',
      'contains pkg:@fx/c -> entry:@fx/c',
      'contains pkg:@fx/d -> entry:@fx/d',
      'depends pkg:@fx/a -> pkg:@fx/b',
      'depends pkg:@fx/b -> pkg:@fx/a',
      'imports file:packages/a/src/index.ts -> entry:@fx/b',
      'imports file:packages/a/src/index.ts -> file:packages/a/src/lazy.ts',
      'imports file:packages/a/src/index.ts -> file:packages/a/src/types/index.ts',
      'imports file:packages/a/src/index.ts -> file:packages/a/src/util.ts',
      'imports file:packages/b/src/index.ts -> entry:@fx/a',
      'imports file:packages/c/src/index.ts -> file:packages/c/src/lib/x.ts',
      'imports file:packages/d/src/__tests__/helper.ts -> file:packages/d/src/index.ts',
      'imports file:packages/d/src/entry.test.ts -> entry:@fx/d',
      'imports file:packages/d/src/index.test.ts -> file:packages/d/src/index.ts',
      'tested_by file:packages/d/src/index.ts -> file:packages/d/src/entry.test.ts',
      'tested_by file:packages/d/src/index.ts -> file:packages/d/src/index.test.ts',
    ]);
  });

  test('a re-export with a .js ending leads to the .ts file; a folder import leads to its index', () => {
    const edges = edgeList({ graph });

    expect(edges).toContain('imports file:packages/a/src/index.ts -> file:packages/a/src/util.ts');
    expect(edges).toContain(
      'imports file:packages/a/src/index.ts -> file:packages/a/src/types/index.ts',
    );
  });

  test('a helper beside the tests is not a test; a test that imports a package entry tests the entry file', () => {
    const edges = edgeList({ graph });

    expect(
      edges.filter((edge) => edge.includes('helper.ts') && edge.startsWith('tested_by')),
    ).toEqual([]);
    expect(edges).toContain(
      'tested_by file:packages/d/src/index.ts -> file:packages/d/src/entry.test.ts',
    );
  });

  test('a dynamic import with a literal is read; an entry that points at a hand-written declaration leads to it', () => {
    const edges = edgeList({ graph });

    expect(edges).toContain('imports file:packages/a/src/index.ts -> file:packages/a/src/lazy.ts');
    expect(edges).toContain('contains entry:@fx/a/t -> file:packages/a/types/t.d.ts');
  });

  test('an entry that points at a built declaration leads to the source it comes from', () => {
    expect(edgeList({ graph })).toContain('contains entry:@fx/b -> file:packages/b/src/index.ts');
  });

  test('imports that are not followed are listed on the file, sorted: npm, node:, an alias not listed', () => {
    const file = (path: string) => graph.nodes.find((node) => node.id === `file:${path}`);

    expect(file('packages/a/src/index.ts')?.external).toEqual(['node:fs', 'zod']);
    expect(file('packages/c/src/index.ts')?.external).toEqual(['~/y']);
    expect(file('packages/a/src/util.ts')?.external).toBeUndefined();
  });

  test('the source says which commit, that the tree is clean, and the scope', () => {
    expect(graph.source.commit).toBe(GitState.commitOf({ root }));
    expect(graph.source.dirty).toBe(false);
    expect(graph.source.scope).toEqual(['packages/a', 'packages/b', 'packages/c', 'packages/d']);
  });

  test('two builds are the same bytes', () => {
    const again = buildOf({ root });

    expect(CodeGraph.render({ graph: again })).toBe(CodeGraph.render({ graph }));
  });

  test('an uncommitted change to a tracked file makes the graph dirty', () => {
    const other = repository();

    writeFileSync(join(other, 'packages/a/src/util.ts'), 'export const util = 2;\n');

    expect(buildOf({ root: other }).source.dirty).toBe(true);
  });
});

describe('what the working tree does not hold', () => {
  test('a tracked file deleted from the working tree is skipped, not a crash', () => {
    const root = repository();

    rmSync(join(root, 'packages/a/src/util.ts'));

    const graph = buildOf({ root });

    expect(graph.nodes.some((node) => node.id === 'file:packages/a/src/util.ts')).toBe(false);
    expect(graph.source.dirty).toBe(true);
  });

  test('a package.json that is not JSON stops the build with a message, not a stack', () => {
    const root = repository();

    writeFileSync(join(root, 'packages/a/package.json'), '{ not json');

    const result = spawnSyncBounded({
      cmd: [process.execPath, CLI, 'graph', 'build'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('vulcan x atlas graph:');
    expect(result.stderr.toString()).not.toContain('    at ');
  });
});

describe('the alias setting', () => {
  test('without graph.aliases an alias import is external; with it the import is followed', () => {
    const root = repository();
    const without = ProjectConfig.toAtlasProject({
      root,
      manifest: { ...MANIFEST, graph: { aliases: {} } },
    });
    const built = CodeGraph.build({ root, project: without });
    const node = built?.nodes.find((item) => item.id === 'file:packages/c/src/index.ts');

    expect(node?.external).toEqual(['@/lib/x', '~/y']);
    expect(built?.edges.some((edge) => edge.to === 'file:packages/c/src/lib/x.ts')).toBe(true);
  });
});

describe('ImportResolver.fileOf', () => {
  const files = new Set(['p/a.ts', 'p/dir/index.tsx', 'p/b.d.ts', 'p/c.mts']);

  test.each([
    ['p/a', 'p/a.ts'],
    ['p/a.js', 'p/a.ts'],
    ['p/a.ts', 'p/a.ts'],
    ['p/dir', 'p/dir/index.tsx'],
    ['p/b', 'p/b.d.ts'],
    ['p/c.mjs', 'p/c.mts'],
    ['p/missing', undefined],
  ])('%s leads to %s', (base, expected) => {
    expect(ImportResolver.fileOf({ base, files })).toBe(expected);
  });
});

describe('vulcan x atlas graph build', () => {
  test('writes .agents/local/graph/code.json and prints one line', () => {
    const root = repository();
    const result = spawnSyncBounded({
      cmd: [process.execPath, CLI, 'graph', 'build'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const file = join(root, '.agents/local/graph/code.json');

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toMatch(
      /^graph: 27 nodes, 35 edges, 12 files, 6 symbols, commit [0-9a-f]{12} -> \.agents\/local\/graph\/code\.json\n$/,
    );
    expect(existsSync(file)).toBe(true);

    const parsed = JSON.parse(readFileSync(file, 'utf8'));

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe('code');
    const ids = (kind: string): string[] =>
      parsed.nodes
        .filter((n: { kind: string }) => n.kind === kind)
        .map((n: { id: string }) => n.id);
    const edges: string[] = parsed.edges.map(
      (e: { kind: string; from: string; to: string }) => `${e.kind} ${e.from} -> ${e.to}`,
    );

    expect(ids('symbol')).toEqual([
      'sym:@fx/a#a',
      'sym:@fx/a#later',
      'sym:@fx/a#util',
      'sym:@fx/a/t#Tt',
      'sym:@fx/c#c',
      'sym:@fx/d#d',
    ]);
    expect(edges).toContain('exports entry:@fx/a -> sym:@fx/a#util');
    expect(edges).toContain('contains file:packages/a/src/util.ts -> sym:@fx/a#util');
    expect(edges).toContain('contains file:packages/a/types/t.d.ts -> sym:@fx/a/t#Tt');
    expect(parsed.nodes).toHaveLength(27);
    expect(parsed.edges).toHaveLength(35);
  });

  test('refuses an argument it does not know', () => {
    const root = repository();
    const result = spawnSyncBounded({
      cmd: [process.execPath, CLI, 'graph', 'build', '--full'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('usage: vulcan x atlas graph build');
  });

  test('outside a repository it says so and writes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-graph-nogit-'));

    roots.push(root);
    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(join(root, '.agents/vulcan.manifest.json'), JSON.stringify(MANIFEST));

    // Wherever the temp folder is (it may sit inside a checkout), git is pointed at a repository that does not exist.
    const result = spawnSyncBounded({
      cmd: [process.execPath, CLI, 'graph', 'build'],
      cwd: root,
      env: { ...process.env, GIT_DIR: join(root, 'no-repository') },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('git cannot list the tracked files');
    expect(existsSync(join(root, '.agents/local/graph/code.json'))).toBe(false);
  });
});
