import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigLoader, VULCAN_CONFIG_SCHEMA, WorkspacePackages } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const manifest = (name: string | undefined, extra: object = {}): string =>
  JSON.stringify({ ...(name === undefined ? {} : { name }), ...extra });
const monorepo = (
  opts: {
    workspaces?: unknown;
    config?: string;
    members?: Record<string, string | undefined>;
  } = {},
) => {
  const members = opts.members ?? {
    'packages/okf': '@x/okf',
    'packages/cli': '@x/cli',
    'apps/web/site': '@x/site',
  };

  return createProject({
    files: {
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: opts.workspaces ?? ['packages/*', 'apps/*/*'],
      }),
      ...Object.fromEntries(
        Object.entries(members).map(([folder, name]) => [`${folder}/package.json`, manifest(name)]),
      ),
      '.configs/vulcan.config.mts': opts.config ?? "export default { name: 'acme' };\n",
    },
  });
};

describe('WorkspacePackages.derive', () => {
  test('reads the workspaces and each package.json: name, path, a dir key from the path, in the order of the paths', () => {
    expect(WorkspacePackages.derive({ root: monorepo() })).toEqual([
      { dir: 'apps-web-site', name: '@x/site', path: 'apps/web/site', aliases: [], retired: false },
      { dir: 'packages-cli', name: '@x/cli', path: 'packages/cli', aliases: [], retired: false },
      { dir: 'packages-okf', name: '@x/okf', path: 'packages/okf', aliases: [], retired: false },
    ]);
  });

  test('the object form of workspaces works, a negation is not a member, and a folder without a pattern is a member', () => {
    const root = monorepo({
      workspaces: { packages: ['packages/okf', '!packages/cli'], catalog: { a: '1' } },
    });

    expect(WorkspacePackages.derive({ root }).map((entry) => entry.path)).toEqual(['packages/okf']);
  });

  test('a member with no name, an invalid name or a folder that cannot be a key is left out; node_modules is never entered', () => {
    const root = monorepo({
      workspaces: ['packages/*'],
      members: {
        'packages/ok': '@x/ok',
        'packages/noname': undefined,
        'packages/Upper': '@x/upper',
        'packages/bad': 'Not A Name',
        'packages/ok/node_modules/dep': '@x/dep',
      },
    });

    expect(WorkspacePackages.derive({ root }).map((entry) => entry.name)).toEqual(['@x/ok']);
  });

  test('no package.json, a broken one and no workspaces give none', () => {
    expect(WorkspacePackages.derive({ root: createProject({ files: {} }) })).toEqual([]);
    expect(
      WorkspacePackages.derive({ root: createProject({ files: { 'package.json': '{ nope' } }) }),
    ).toEqual([]);
    expect(
      WorkspacePackages.derive({
        root: createProject({ files: { 'package.json': '{"name":"x"}' } }),
      }),
    ).toEqual([]);
  });

  test('this repository: its three packages, from its own root', () => {
    expect(
      WorkspacePackages.derive({ root: join(import.meta.dir, '../../../../..') }).map(
        (entry) => entry.name,
      ),
    ).toEqual(['@venizia/vulcan-atlas', '@venizia/vulcan', '@venizia/vulcan-okf']);
  });

  test('every derived entry is one the packages schema accepts', () => {
    const entries = WorkspacePackages.derive({ root: monorepo() });

    expect(VULCAN_CONFIG_SCHEMA.safeParse({ packages: entries }).success).toBe(true);
  });
});

describe('the loader: packages the config does not write are derived, a list it writes is the list', () => {
  test('an absent key is derived, and `vulcan config --effective` says so', async () => {
    const root = monorepo();
    const loaded = await ConfigLoader.load({ root });

    expect(loaded.ok ? loaded.config.packages.map((entry) => entry.name) : []).toEqual([
      '@x/site',
      '@x/cli',
      '@x/okf',
    ]);
    expect(loaded.ok ? loaded.layers.merge.from.packages : undefined).toBe('workspaces');

    const out = JSON.parse(runCli({ args: ['config', '--effective'], cwd: root }).stdout);

    expect(out.config.packages).toHaveLength(3);
    expect(out.from.packages).toBe('workspaces');
  });

  test('packages: [] keeps none, and a written list is exactly the list', async () => {
    const none = await ConfigLoader.load({
      root: monorepo({ config: 'export default { packages: [] };\n' }),
    });
    const listed = await ConfigLoader.load({
      root: monorepo({
        config:
          "export default { packages: [{ dir: 'only', name: '@x/cli', path: 'packages/cli' }] };\n",
      }),
    });

    expect(none.ok ? none.config.packages : undefined).toEqual([]);
    expect(none.ok ? none.layers.merge.from.packages : 'x').toBe('project');
    expect(listed.ok ? listed.config.packages.map((entry) => entry.dir) : []).toEqual(['only']);
  });

  test('a project with no workspaces has no packages, as before', async () => {
    const loaded = await ConfigLoader.load({
      root: createProject({
        files: { '.configs/vulcan.config.mts': "export default { name: 'acme' };\n" },
      }),
    });

    expect(loaded.ok ? loaded.config.packages : undefined).toEqual([]);
  });
});

describe('doctor: a workspace member the list does not name', () => {
  const check = async (root: string) => {
    const loaded = await ConfigLoader.load({ root });

    return loaded.ok
      ? ProjectContract.checkWorkspacePackages({
          root,
          config: loaded.config,
          configFile: '.configs/vulcan.config.mts',
        })
      : [];
  };

  test('is a warning that names the members and the way out', async () => {
    const root = monorepo({
      config:
        "export default { packages: [{ dir: 'cli', name: '@x/cli', path: 'packages/cli' }] };\n",
    });
    const [hit] = await check(root);

    expect(hit?.check).toBe('workspace-packages');
    expect(hit?.message).toContain('@x/okf (packages/okf)');
    expect(hit?.message).toContain('@x/site (apps/web/site)');
    expect(hit?.message).not.toContain('@x/cli');
    expect(hit?.message).toContain('delete `packages`');
  });

  test('a derived list, a full list and a retired entry that holds the path have none', async () => {
    const result = await check(monorepo());
    expect(result).toEqual([]);
    const result2 = await check(
      monorepo({
        config:
          "export default { packages: [{ dir: 'a', name: '@x/okf', path: 'packages/okf' }, { dir: 'b', name: '@x/cli', path: 'packages/cli', retired: true }, { dir: 'c', name: '@x/site', path: 'apps/web/site' }] };\n",
      }),
    );
    expect(result2).toEqual([]);
  });
});
