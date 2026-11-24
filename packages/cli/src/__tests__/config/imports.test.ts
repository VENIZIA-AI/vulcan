import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
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

    runCli({ args: ['sync'], cwd: root });

    expect(readFileSync(join(root, '.agents/local/vulcan.manifest.json'), 'utf8')).toContain(
      '.configs/vulcan/claude.mts',
    );
    expect(ProjectGuards.readPolicy({ root, env: {} }).configModules).toContain(
      '.configs/vulcan/doctor.mts',
    );
  });
});

describe('vulcan init writes the config split', () => {
  test('the config and its modules, which load, are in order, and leave the packages to the workspaces', async () => {
    const root = createProject({ files: { 'package.json': '{ "name": "demo" }' } });
    const run = runCli({ args: ['init', '--key', 'DEMO'], cwd: root });
    const loaded = await ConfigLoader.load({ root });

    expect(run.code, run.stderr).toBe(0);
    expect(ConfigImports.localModules({ root })).toEqual([
      '.configs/vulcan/claude.mts',
      '.configs/vulcan/doctor.mts',
      '.configs/vulcan/index.mts',
      '.configs/vulcan/okf.mts',
      '.configs/vulcan/packages.mts',
    ]);
    expect(loaded.ok && loaded.config.project).toEqual({ key: 'DEMO' });
    expect(loaded.ok && loaded.layers.merge.from.packages).toBe('workspaces');
    expect(runCli({ args: ['config', 'format', '--check'], cwd: root }).code).toBe(0);
  });
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
    expect(scan.problems.map((problem) => problem.file)).toEqual(['src/app.ts']);
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

  test('sync and doctor warn about such a module', async () => {
    const root = createProject({ files: { ...SPLIT, 'package.json': '{ "name": "demo" }' } });
    const run = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });
    const warnings = await DoctorRunner.runWarnings({ root });

    expect(run.stderr).toContain('warning   src/shared.ts: a module of the config');
    expect(
      warnings
        .filter((warning) => warning.check === 'config-modules')
        .map((warning) => warning.file),
    ).toEqual(['src/shared.ts']);
  });
});
