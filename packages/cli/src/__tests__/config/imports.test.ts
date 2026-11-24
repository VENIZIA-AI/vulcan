import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigImports } from '../../config/imports.ts';
import { ConfigLoader } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { ProjectGuards } from '../../hooks/project-guards.ts';
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
