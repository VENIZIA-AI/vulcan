import { expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

export const roots: string[] = [];

/** Removes every repository the fixture made; each test file registers it in its own afterAll. */
export const removeRepositories = (): void => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
};

export const CLI = join(__dirname, '..', '..', 'cli.ts');

export const pkg = (name: string, extra: object = {}): string =>
  JSON.stringify({ name, version: '1.0.0', exports: { '.': './src/index.ts' }, ...extra });

export const FILES: Record<string, string> = {
  'packages/a/package.json': pkg('@fx/a', {
    exports: { '.': './src/index.ts', './t': './types/t.d.ts' },
    dependencies: { '@fx/b': '1.0.0', zod: '4.0.0' },
  }),
  'packages/a/types/t.d.ts': 'export type Tt = 1;\nexport interface Holder {\n  t: Tt;\n}\n',
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

export const MANIFEST = {
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

export const git = (opts: { root: string; args: string[] }): void => {
  const result = spawnSyncBounded({ cmd: ['git', ...opts.args], cwd: opts.root, stdout: 'pipe' });

  expect(result.exitCode).toBe(0);
};

/** A git repository holding the fixture files and the manifest, committed. */
export const repository = (): string => {
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

/** Runs the atlas CLI in a fixture; `env` is added to the process environment. */
export const atlas = (opts: { root: string; args: string[]; env?: Record<string, string> }) =>
  spawnSyncBounded({
    cmd: [process.execPath, CLI, ...opts.args],
    cwd: opts.root,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
