import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync } from 'node:fs';
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

const git = (opts: { cwd: string; args: string[] }) =>
  Bun.spawnSync(['git', ...opts.args], { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
const repository = (root: string): void => {
  git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
  git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
  git({ cwd: root, args: ['config', 'user.name', 'a'] });
};
const names = (root: string): string[] =>
  WorkspacePackages.derive({ root }).packages.map((entry) => entry.name);

describe('WorkspacePackages.derive', () => {
  test('reads the workspaces and each package.json: name, path, a dir key from the path, in the order of the paths', () => {
    expect(WorkspacePackages.derive({ root: monorepo() })).toEqual({
      packages: [
        {
          dir: 'apps-web-site',
          name: '@x/site',
          path: 'apps/web/site',
          aliases: [],
          retired: false,
        },
        { dir: 'packages-cli', name: '@x/cli', path: 'packages/cli', aliases: [], retired: false },
        { dir: 'packages-okf', name: '@x/okf', path: 'packages/okf', aliases: [], retired: false },
      ],
      skipped: [],
      errors: [],
    });
  });

  test('the object form of workspaces works, and a folder without a pattern is a member', () => {
    const root = monorepo({ workspaces: { packages: ['packages/okf'], catalog: { a: '1' } } });

    expect(WorkspacePackages.derive({ root }).packages.map((entry) => entry.path)).toEqual([
      'packages/okf',
    ]);
  });

  test('a ! pattern takes out what the patterns before it gave, and a later pattern can bring it back', () => {
    expect(names(monorepo({ workspaces: ['packages/*', '!packages/cli'] }))).toEqual(['@x/okf']);
    expect(names(monorepo({ workspaces: ['packages/*', '!packages/*', 'packages/cli'] }))).toEqual([
      '@x/cli',
    ]);
    expect(names(monorepo({ workspaces: ['!packages/cli', 'packages/*'] }))).toEqual([
      '@x/cli',
      '@x/okf',
    ]);
  });

  test('a member that cannot be a package is named with its reason and left out, never normalised', () => {
    const root = monorepo({
      workspaces: ['packages/*', 'apps/*'],
      members: {
        'packages/ok': '@x/ok',
        'packages/noname': undefined,
        'packages/my_lib': '@x/lib',
        'apps/WebApp': '@x/web',
        'packages/bad': 'Not A Name',
      },
    });
    const derived = WorkspacePackages.derive({ root });

    expect(derived.packages.map((entry) => entry.name)).toEqual(['@x/ok']);
    expect(derived.skipped.map((entry) => entry.path)).toEqual([
      'apps/WebApp',
      'packages/bad',
      'packages/my_lib',
      'packages/noname',
    ]);
    expect(derived.skipped.every((entry) => entry.reason.length > 0)).toBe(true);
    expect(derived.errors).toEqual([]);
  });

  test('two members that give one key or one name make the whole list an error that names both', () => {
    const key = WorkspacePackages.derive({
      root: monorepo({
        workspaces: ['a/*', 'a-b/*'],
        members: { 'a/b-c': '@x/one', 'a-b/c': '@x/two' },
      }),
    });
    const name = WorkspacePackages.derive({
      root: monorepo({
        workspaces: ['packages/*'],
        members: { 'packages/a': '@x/same', 'packages/b': '@x/same' },
      }),
    });

    expect(key.packages).toEqual([]);
    expect(key.errors[0]).toContain('a-b/c and a/b-c');
    expect(key.errors[0]).toContain("'a-b-c'");
    expect(name.errors[0]).toContain('packages/a and packages/b');
    expect(name.errors[0]).toContain("name '@x/same'");
  });

  test('a pattern that leaves the root is an error up front', () => {
    const outside = WorkspacePackages.derive({ root: monorepo({ workspaces: ['../other/*'] }) });
    const absolute = WorkspacePackages.derive({ root: monorepo({ workspaces: ['/etc/*'] }) });
    const negated = WorkspacePackages.derive({
      root: monorepo({ workspaces: ['packages/*', '!../x'] }),
    });

    for (const found of [outside, absolute, negated]) {
      expect(found.packages).toEqual([]);
      expect(found.errors[0]).toContain('leaves the project root');
    }
  });

  test('outside git node_modules is never entered, even for a ** pattern', () => {
    const root = monorepo({
      workspaces: ['packages/**'],
      members: { 'packages/ok': '@x/ok', 'packages/ok/node_modules/dep': '@x/dep' },
    });
    const blocked = join(root, 'packages/ok/node_modules');

    // A folder that cannot be read: a walk that entered it would fail, and so would derive.
    chmodSync(blocked, 0o000);

    try {
      const derived = WorkspacePackages.derive({ root });

      expect(derived.errors).toEqual([]);
      expect(derived.packages.map((entry) => entry.name)).toEqual(['@x/ok']);
    } finally {
      chmodSync(blocked, 0o755);
    }
  });

  test('in a git repository only the members whose package.json git tracks count; a staged one does', () => {
    const root = monorepo();

    repository(root);
    git({ cwd: root, args: ['add', 'package.json', 'packages/okf'] });
    expect(names(root)).toEqual(['@x/okf']);
    git({ cwd: root, args: ['add', 'packages/cli'] });
    expect(names(root)).toEqual(['@x/cli', '@x/okf']);
  });

  test('no package.json, a broken one and no workspaces give none', () => {
    expect(WorkspacePackages.derive({ root: createProject({ files: {} }) }).packages).toEqual([]);
    expect(
      WorkspacePackages.derive({ root: createProject({ files: { 'package.json': '{ nope' } }) })
        .packages,
    ).toEqual([]);
    expect(
      WorkspacePackages.derive({
        root: createProject({ files: { 'package.json': '{"name":"x"}' } }),
      }).packages,
    ).toEqual([]);
  });

  test('this repository: its three packages, from its own root', () => {
    expect(names(join(import.meta.dir, '../../../../..'))).toEqual([
      '@venizia/vulcan-atlas',
      '@venizia/vulcan',
      '@venizia/vulcan-okf',
    ]);
  });

  test('every derived list is one the packages schema accepts', () => {
    const { packages } = WorkspacePackages.derive({ root: monorepo() });

    expect(VULCAN_CONFIG_SCHEMA.safeParse({ packages }).success).toBe(true);
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

  test('a collision or a pattern that leaves the root fails the load, naming the paths; a written list is not derived at all', async () => {
    const collision = await ConfigLoader.load({
      root: monorepo({
        workspaces: ['a/*', 'a-b/*'],
        members: { 'a/b-c': '@x/one', 'a-b/c': '@x/two' },
      }),
    });
    const leaving = await ConfigLoader.load({ root: monorepo({ workspaces: ['../x/*'] }) });
    const written = await ConfigLoader.load({
      root: monorepo({
        workspaces: ['a/*', 'a-b/*'],
        members: { 'a/b-c': '@x/one', 'a-b/c': '@x/two' },
        config: 'export default { packages: [] };\n',
      }),
    });

    expect(collision.ok ? '' : collision.error).toContain('a-b/c and a/b-c');
    expect(collision.ok ? '' : collision.error).toContain('invalid workspaces');
    expect(leaving.ok ? '' : leaving.error).toContain('leaves the project root');
    expect(written.ok).toBe(true);
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

  test('members that cannot be a package are named with their reason, for a derived list too', async () => {
    const root = monorepo({
      workspaces: ['packages/*'],
      members: { 'packages/ok': '@x/ok', 'packages/my_lib': '@x/lib' },
    });
    const [hit] = await check(root);

    expect(hit?.message).toContain('packages/my_lib');
    expect(hit?.message).toContain('cannot be a package');
    expect(hit?.message).toContain('write `packages`');
  });

  test('a path written with a leading ./ names the member', async () => {
    const root = monorepo({
      workspaces: ['packages/*'],
      members: { 'packages/okf': '@x/okf' },
      config:
        "export default { packages: [{ dir: 'okf', name: '@x/okf', path: './packages/okf/' }] };\n",
    });

    const result = await check(root);
    expect(result).toEqual([]);
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
