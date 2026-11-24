import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigImports } from '../../config/imports.ts';
import { ConfigLoader } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { ProjectGuards } from '../../hooks/project-guards.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const SPLIT = {
  '.configs/vulcan.config.mts': [
    "import type { VulcanConfig } from '@venizia/vulcan';",
    "import { claude, doctor } from './vulcan/index.mts';",
    "import { extra } from './policy.js';",
    "import { shared } from '../src/shared.ts';",
    '',
    "export default { name: 'demo', claude, doctor, theme: extra, board: shared } satisfies VulcanConfig;",
    '',
  ].join('\n'),
  '.configs/vulcan/index.mts':
    "export { claude } from './claude.mts';\nexport * from './doctor';\n",
  '.configs/vulcan/claude.mts': 'export const claude = { settings: {} };\n',
  '.configs/vulcan/doctor.mts':
    "import { claude } from './claude.mts';\nexport const doctor = { privateValues: { acknowledged: [] } };\nvoid claude;\n",
  '.configs/policy.ts': 'export const extra = undefined;\n',
  '.configs/lints/eslint.config.mts': 'export default [];\n',
  'src/shared.ts':
    "import { extra } from '../.configs/policy.ts';\nexport const shared = { agents: {} };\nvoid extra;\n",
};

describe('ConfigImports.localModules', () => {
  test('follows every relative import under .configs/, a .js name to its .ts file and a folder-less name to its file', () => {
    const root = createProject({ files: SPLIT });

    expect(ConfigImports.localModules({ root })).toEqual([
      '.configs/policy.ts',
      '.configs/vulcan/claude.mts',
      '.configs/vulcan/doctor.mts',
      '.configs/vulcan/index.mts',
    ]);
  });

  test('a single-file config, and a project with no config, have none', () => {
    expect(
      ConfigImports.localModules({
        root: createProject({ files: { '.configs/vulcan.config.mts': 'export default {};\n' } }),
      }),
    ).toEqual([]);
    expect(ConfigImports.localModules({ root: createProject({ files: {} }) })).toEqual([]);
  });

  test('the split config loads, and sync records its modules in the manifest the guards read', async () => {
    const root = createProject({ files: { ...SPLIT, 'package.json': '{ "name": "demo" }' } });
    const loaded = await ConfigLoader.load({ root });

    expect(loaded.ok && loaded.config.name).toBe('demo');

    if (!loaded.ok) {
      return;
    }

    const manifest: unknown = JSON.parse(ProjectManifest.render({ root, config: loaded.config }));

    expect(manifest).toMatchObject({
      guard: {
        configModules: [
          '.configs/policy.ts',
          '.configs/vulcan/claude.mts',
          '.configs/vulcan/doctor.mts',
          '.configs/vulcan/index.mts',
        ],
      },
    });

    runCli({ args: ['project', 'sync'], cwd: root });

    expect(readFileSync(join(root, '.agents/local/vulcan.manifest.json'), 'utf8')).toContain(
      '.configs/vulcan/claude.mts',
    );
    expect(ProjectGuards.readPolicy({ root, env: {} }).configModules).toContain(
      '.configs/vulcan/doctor.mts',
    );
  });
});

describe('vulcan project init writes the config split', () => {
  test('the config and its modules, which load, are in order, and leave the packages to the workspaces', async () => {
    const root = createProject({ files: { 'package.json': '{ "name": "demo" }' } });
    const run = runCli({ args: ['project', 'init', '--key', 'DEMO'], cwd: root });
    const loaded = await ConfigLoader.load({ root });

    expect(run.code, run.stderr).toBe(0);
    expect(ConfigImports.localModules({ root })).toEqual([
      '.configs/vulcan/agent.mts',
      '.configs/vulcan/board.mts',
      '.configs/vulcan/check.mts',
      '.configs/vulcan/common.mts',
      '.configs/vulcan/guard.mts',
      '.configs/vulcan/index.mts',
      '.configs/vulcan/knowledge.mts',
      '.configs/vulcan/project.mts',
    ]);
    expect(loaded.ok && loaded.config.project).toEqual({ key: 'DEMO' });
    expect(loaded.ok && loaded.config.agents).toEqual(['claude']);
    expect(loaded.ok && loaded.layers.merge.from.packages).toBe('workspaces');
    expect(runCli({ args: ['config', 'format', '--check'], cwd: root }).code).toBe(0);
  }, 30_000);
});

describe('ConfigImports.scan: what the guards cannot protect', () => {
  const config = (body: string) => `${body}\nexport default { name: 'demo' };\n`;

  test('a module outside .configs/, at any depth, is named with the way to fix it', () => {
    const root = createProject({ files: SPLIT });
    const { problems } = ConfigImports.scan({ root });

    expect(problems.map((problem) => problem.file)).toEqual(['src/shared.ts']);
    expect(problems[0]?.message).toContain('move it under .configs/ so the guard protects it');
    expect(problems[0]?.message).toContain('reached from .configs/vulcan.config.mts');
  });

  test('a tsconfig paths alias and a package.json #import are followed: into .configs/ protected, elsewhere named', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': config(
          "import { a } from '@cfg/claude';\nimport { b } from '#policy';\nimport { c } from '~/app.ts';",
        ),
        '.configs/vulcan/claude.mts': 'export const a = 1;\n',
        '.configs/policy.mts': 'export const b = 1;\n',
        'src/app.ts': 'export const c = 1;\n',
        'tsconfig.json': JSON.stringify({
          compilerOptions: { paths: { '@cfg/*': ['./.configs/vulcan/*'], '~/*': ['./src/*'] } },
        }),
        'package.json': JSON.stringify({
          name: 'demo',
          imports: { '#policy': './.configs/policy.mts' },
        }),
      },
    });
    const scan = ConfigImports.scan({ root });

    expect(scan.modules).toEqual(['.configs/policy.mts', '.configs/vulcan/claude.mts']);
    expect(scan.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining(
        "imports .configs/vulcan/claude.mts through the alias '@cfg/claude': import it by a relative path",
      ),
      expect.stringContaining(
        "imports .configs/policy.mts through the alias '#policy': import it by a relative path",
      ),
      expect.stringContaining(
        "imports src/app.ts through the alias '~/app.ts': import it by a relative path",
      ),
      expect.stringContaining('a module of the config outside .configs/'),
    ]);
  });

  test('a specifier that names nothing known is named; an installed or declared package and a built-in are not', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': config(
          "import type { VulcanConfig } from '@venizia/vulcan';\nimport { x } from '@nowhere/policy';\nimport { y } from 'declared-only';\nimport { z } from 'node:path';\nimport { w } from 'fs';\nimport { v } from '#missing';",
        ),
        'package.json': JSON.stringify({
          name: 'demo',
          dependencies: { 'declared-only': '1.0.0' },
        }),
      },
    });

    expect(ConfigImports.scan({ root }).problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining("imports '@nowhere/policy'"),
      expect.stringContaining("imports '#missing'"),
    ]);
  });

  test('a link is recorded by its path and its real path; a link that leads out of .configs/ is named', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': config(
          "import { a } from './vulcan/inside.mts';\nimport { b } from './vulcan/outside.mts';",
        ),
        '.configs/real/inside.mts': 'export const a = 1;\n',
        'shared/outside.mts': 'export const b = 1;\n',
      },
    });

    mkdirSync(join(root, '.configs/vulcan'), { recursive: true });
    symlinkSync(join(root, '.configs/real/inside.mts'), join(root, '.configs/vulcan/inside.mts'));
    symlinkSync(join(root, 'shared/outside.mts'), join(root, '.configs/vulcan/outside.mts'));

    const scan = ConfigImports.scan({ root });

    expect(scan.modules).toEqual([
      '.configs/real/inside.mts',
      '.configs/vulcan/inside.mts',
      '.configs/vulcan/outside.mts',
    ]);
    expect(scan.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('(a link to shared/outside.mts) outside .configs/'),
    ]);
  });

  test('a package of this repository (a workspace member, a link) is a local module; one declared with a local protocol but not installed is named', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': config(
          "import { a } from '@acme/policy';\nimport { b } from 'local-rules';\nimport type { T } from '@acme/types';",
        ),
        'packages/policy/package.json': '{ "name": "@acme/policy" }',
        'packages/policy/index.ts': 'export const a = 1;\n',
        'package.json': JSON.stringify({
          name: 'demo',
          dependencies: { 'local-rules': 'file:./rules', '@acme/types': 'workspace:*' },
        }),
      },
    });

    mkdirSync(join(root, 'node_modules/@acme'), { recursive: true });
    symlinkSync(join(root, 'packages/policy'), join(root, 'node_modules/@acme/policy'));

    expect(ConfigImports.scan({ root }).problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining(
        "imports '@acme/policy', a package of this repository (packages/policy)",
      ),
      expect.stringContaining(
        "imports 'local-rules', a package of this repository (declared as file:./rules, not installed)",
      ),
    ]);
  });

  test('in a project that is a folder of a monorepo, a workspace member linked from above is a local module', () => {
    const monorepo = createProject({
      files: {
        'apps/web/.configs/vulcan.config.mts': config("import { a } from '@acme/policy';"),
        'apps/web/package.json': '{ "name": "web" }',
        'packages/policy/package.json': '{ "name": "@acme/policy" }',
        'packages/policy/index.ts': 'export const a = 1;\n',
      },
    });

    mkdirSync(join(monorepo, 'node_modules/@acme'), { recursive: true });
    symlinkSync(join(monorepo, 'packages/policy'), join(monorepo, 'node_modules/@acme/policy'));

    expect(
      ConfigImports.scan({ root: join(monorepo, 'apps/web') }).problems.map(
        (problem) => problem.message,
      ),
    ).toEqual([
      expect.stringContaining(
        "imports '@acme/policy', a package of this repository (../../packages/policy)",
      ),
    ]);
  });

  test('a config file that is a link out of .configs/ is named', () => {
    const root = createProject({ files: { 'shared/vulcan.config.mts': config('') } });

    mkdirSync(join(root, '.configs'), { recursive: true });
    symlinkSync(join(root, 'shared/vulcan.config.mts'), join(root, '.configs/vulcan.config.mts'));

    expect(ConfigImports.scan({ root }).problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('is a link to shared/vulcan.config.mts, outside .configs/'),
    ]);
  });

  test('a module that cannot be read is a warning, not a crash', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': config("import { a } from './vulcan/locked.mts';"),
        '.configs/vulcan/locked.mts': 'export const a = 1;\n',
      },
    });

    chmodSync(join(root, '.configs/vulcan/locked.mts'), 0o000);

    const scan = ConfigImports.scan({ root });

    chmodSync(join(root, '.configs/vulcan/locked.mts'), 0o644);

    expect(scan.modules).toEqual(['.configs/vulcan/locked.mts']);
    expect(scan.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('cannot be read'),
    ]);
  });

  test('sync and doctor warn about such a module', async () => {
    const root = createProject({ files: { ...SPLIT, 'package.json': '{ "name": "demo" }' } });
    const run = runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });
    const warnings = await DoctorRunner.runWarnings({ root });

    expect(run.stderr).toContain('warning   src/shared.ts: a module of the config');
    expect(
      warnings
        .filter((warning) => warning.check === 'config-modules')
        .map((warning) => warning.file),
    ).toEqual(['src/shared.ts']);
  });
});
