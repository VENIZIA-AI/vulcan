import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LayoutFolder } from '../../common/layout-folder.ts';
import { ConfigLoader } from '../../config/index.ts';
import { DoctorChecks, DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND = `file:${join(FIXTURES, 'preset-backend')}`;
const FRONTEND = `file:${join(FIXTURES, 'preset-frontend')}`;
const ENV = { VULCAN_NO_INSTALL: '1' };

describe('LayoutFolder.layoutFolderProblem', () => {
  test.each(['services', 'frontends/apps', 'a/b/c/d', 'web-2/app1', '0/1'])(
    '%s is a folder',
    (folder) => {
      expect(LayoutFolder.layoutFolderProblem({ folder })).toBeUndefined();
    },
  );

  test.each([
    ['', 'non-empty'],
    ['/abs', 'starts or ends'],
    ['trailing/', 'starts or ends'],
    ['a//b', 'empty segment'],
    ['../up', 'climbs'],
    ['a/../b', 'climbs'],
    ['.', 'climbs'],
    ['a/./b', 'climbs'],
    ['a\\b', 'backslash'],
    ['Upper/case', 'lowercase'],
    ['a/b c', 'lowercase'],
    ['-lead', 'lowercase'],
    ['a/node_modules/b', 'node_modules'],
    ['node_modules', 'node_modules'],
    ['a/b/c/d/e', 'more than 4'],
  ])('%s is not (%s)', (folder, why) => {
    expect(LayoutFolder.layoutFolderProblem({ folder })).toContain(why);
  });

  test('something that is not a string is not a folder', () => {
    expect(LayoutFolder.layoutFolderProblem({ folder: 7 })).toBeDefined();
    expect(LayoutFolder.layoutFolderProblem({ folder: null })).toBeDefined();
  });
});

describe('the layout as a whole', () => {
  test('a folder under two keys, or listed twice, is a problem', () => {
    expect(
      LayoutFolder.layoutOverlapProblems({ layout: { backend: 'a', frontend: ['b', 'a'] } }).join(
        ' ',
      ),
    ).toContain("layout.frontend names 'a' again (also layout.backend)");
    expect(LayoutFolder.layoutOverlapProblems({ layout: { frontend: ['b', 'b'] } })).toHaveLength(
      1,
    );
  });

  test('a folder inside another, in either order and across keys, is a problem', () => {
    expect(
      LayoutFolder.layoutOverlapProblems({
        layout: { backend: 'frontends', frontend: 'frontends/apps' },
      }),
    ).toHaveLength(1);
    expect(
      LayoutFolder.layoutOverlapProblems({ layout: { frontend: ['frontends/apps', 'frontends'] } }),
    ).toHaveLength(1);
    expect(
      LayoutFolder.layoutOverlapProblems({ layout: { shared: 'a/b', other: 'a/b/c' } }),
    ).toHaveLength(1);
    // A shared prefix is not nesting.
    expect(
      LayoutFolder.layoutOverlapProblems({
        layout: { backend: 'frontends/apps', frontend: 'frontends/apps2' },
      }),
    ).toEqual([]);
  });

  test('a string grows into a list, a listed folder changes nothing, none makes a string', () => {
    expect(LayoutFolder.withLayoutFolder({ value: undefined, folder: 'a' })).toBe('a');
    expect(LayoutFolder.withLayoutFolder({ value: 'a', folder: 'a' })).toBe('a');
    expect(LayoutFolder.withLayoutFolder({ value: 'a', folder: 'b' })).toEqual(['a', 'b']);
    expect(LayoutFolder.withLayoutFolder({ value: ['a', 'b'], folder: 'b' })).toEqual(['a', 'b']);
    expect(LayoutFolder.withLayoutFolder({ value: ['a', 'b'], folder: 'c' })).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  test('only the valid folders of a layout value are kept', () => {
    expect(LayoutFolder.valid({ value: ['a', 7, '../x', 'b/c'] })).toEqual(['a', 'b/c']);
  });
});

const configOf = async (opts: { layout: string }) => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': `export default { layout: ${opts.layout} };\n`,
    },
  });

  return ConfigLoader.load({ root });
};

describe('the config schema', () => {
  test('a string, a list and other are accepted', async () => {
    const result = await configOf({
      layout:
        "{ backend: 'backends', frontend: ['frontends/apps', 'frontends/guests'], shared: 'frontends/kits', other: ['docs', 'qc'] }",
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.config.layout?.frontend : undefined).toEqual([
      'frontends/apps',
      'frontends/guests',
    ]);
  });

  test.each([
    ["{ backend: '../x' }", 'climbs'],
    ["{ backend: '/abs' }", 'starts or ends'],
    ["{ backend: ['ok', 'a//b'] }", 'empty segment'],
    ['{ frontend: [] }', 'Too small'],
    ["{ backend: 'a', frontend: 'a' }", 'names'],
    ["{ backend: 'a', frontend: 'a/b' }", 'nested'],
    ["{ other: ['a', 'a/b'] }", 'nested'],
    ["{ other: 'node_modules/x' }", 'node_modules'],
  ])('%s is refused', async (layout, why) => {
    const result = await configOf({ layout });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(why);
  });
});

/** A monorepo made from the backend preset in its own folder, so a test can add to it. */
const monorepo = (opts: { backendDir?: string; shared?: string } = {}): string => {
  const parent = createProject({ files: {} });
  const result = runCli({
    args: [
      'init',
      '--preset',
      BACKEND,
      '--project',
      'p',
      '--key',
      'TEST',
      '--backend-dir',
      opts.backendDir ?? 'backends',
      '--app',
      'core-api',
      ...(opts.shared === undefined ? [] : ['--shared-dir', opts.shared]),
    ],
    cwd: parent,
    env: ENV,
  });

  expect(result.code, result.stderr).toBe(0);

  return join(parent, 'p');
};

const layoutOf = async (opts: { root: string }) => {
  const loaded = await ConfigLoader.load({ root: opts.root });

  return loaded.ok ? loaded.config.layout : undefined;
};

describe('vulcan init --preset with folder paths', () => {
  test('a backend folder and a shared folder two levels deep', async () => {
    const root = monorepo({ backendDir: 'frontends/apps', shared: 'frontends/kits' });

    expect(existsSync(join(root, 'frontends/apps/core-api/package.json'))).toBe(true);
    const result = await layoutOf({ root });
    expect(result).toEqual({ backend: 'frontends/apps', shared: 'frontends/kits' });
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('frontends/apps/*');
  });

  test.each([
    [['--backend-dir', '../up'], 'climbs'],
    [['--backend-dir', 'a/node_modules/b'], 'node_modules'],
    [['--backend-dir', 'frontends', '--shared-dir', 'frontends/kits'], 'nested'],
    [['--backend-dir', 'a/b/c/d/e'], 'more than 4'],
  ])('%j is refused before anything is written', (flags, why) => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: [
        'init',
        '--preset',
        BACKEND,
        '--project',
        'p',
        '--key',
        'TEST',
        '--app',
        'core-api',
        ...flags,
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(why);
    expect(existsSync(join(parent, 'p'))).toBe(false);
  });
});

describe('vulcan add with several folders per side', () => {
  test('a second folder grows the string into a list, and the app lands in it', async () => {
    const root = monorepo({ backendDir: 'backends' });
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends-2/services', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(join(root, 'backends-2/services/worker/package.json'))).toBe(true);
    const layout = await layoutOf({ root });

    expect(layout?.backend).toEqual(['backends', 'backends-2/services']);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('backends-2/services/*');
  });

  test('with several folders listed the flag is required, and the error lists them', async () => {
    const root = monorepo({ backendDir: 'backends' });

    runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    const missing = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'job'],
      cwd: root,
      env: ENV,
    });
    const listed = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends-2', '--app', 'job'],
      cwd: root,
      env: ENV,
    });
    const first = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends', '--app', 'queue'],
      cwd: root,
      env: ENV,
    });

    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('missing --backend-dir');
    expect(missing.stderr).toContain("the layout lists 'backends', 'backends-2'");
    expect(listed.code, listed.stderr).toBe(0);
    expect(first.code, first.stderr).toBe(0);
    // A folder that is listed already changes nothing in the layout.
    const layout = await layoutOf({ root });

    expect(layout?.backend).toEqual(['backends', 'backends-2']);
    expect(existsSync(join(root, 'backends/queue/package.json'))).toBe(true);
  });

  test('the hand-added lines show the list when the apps block cannot be extended', () => {
    const root = monorepo({ backendDir: 'backends' });
    const config = join(root, '.configs/vulcan.config.mts');

    writeFileSync(config, readFileSync(config, 'utf8').replace('// vulcan:apps:start', '// gone'));

    const result = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("layout: { backend: ['backends', 'backends-2'] },");
  });

  test('a folder listed under other is not an app target, and the error says so', async () => {
    const root = monorepo({ backendDir: 'backends' });
    const config = join(root, '.configs/vulcan.config.mts');

    writeFileSync(
      config,
      readFileSync(config, 'utf8').replace('"layout": {', '"layout": {\n    "other": ["docs"],'),
    );

    const result = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'docs', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('listed under layout.other');
  });

  test('a folder that is not a folder, nested in another, or another key is refused, nothing written', async () => {
    const root = monorepo({ backendDir: 'backends', shared: 'kits' });
    const cases: [string, string][] = [
      ['../up', 'climbs'],
      ['backends/deeper', 'nested'],
      ['kits', 'is the shared folder'],
    ];

    for (const [folder, why] of cases) {
      const result = runCli({
        args: ['add', '--preset', BACKEND, '--backend-dir', folder, '--app', 'worker'],
        cwd: root,
        env: ENV,
      });

      expect(result.code, folder).toBe(1);
      expect(result.stderr, folder).toContain(why);
    }

    expect(existsSync(join(root, 'worker'))).toBe(false);
    const layout = await layoutOf({ root });

    expect(layout?.backend).toBe('backends');
  });

  test('a frontend finds its backend in any folder of the backend list', async () => {
    const root = monorepo({ backendDir: 'backends' });

    runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    const result = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'frontends/apps',
        '--app',
        'web',
        '--api',
        'worker',
      ],
      cwd: root,
      env: ENV,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(readFileSync(join(root, 'frontends/apps/web/vite.config.ts'), 'utf8')).toContain(
      'localhost:',
    );
    const layout = await layoutOf({ root });

    expect(layout?.frontend).toBe('frontends/apps');
  });
});

describe('vulcan add --lib with several shared folders', () => {
  test('--dir picks a listed folder; without it the error lists them; a new valid one is added', async () => {
    const root = createProject({ files: {} });
    const lib = join(FIXTURES, 'preset-with-lib');
    const init = runCli({
      args: [
        'init',
        '--preset',
        `file:${lib}`,
        '--project',
        'p',
        '--key',
        'TEST',
        '--backend-dir',
        'backends',
        '--app',
        'core-api',
        '--shared-dir',
        'kits/a',
      ],
      cwd: root,
      env: ENV,
    });

    expect(init.code, init.stderr).toBe(0);

    const repo = join(root, 'p');
    const second = runCli({
      args: ['add', '--preset', `file:${lib}`, '--lib', 'money', '--dir', 'kits/b'],
      cwd: repo,
      env: ENV,
    });

    expect(second.code, second.stderr).toBe(0);
    const layout = await layoutOf({ root: repo });

    expect(layout?.shared).toEqual(['kits/a', 'kits/b']);

    const missing = runCli({
      args: ['add', '--preset', `file:${lib}`, '--lib', 'tax'],
      cwd: repo,
      env: ENV,
    });

    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("the layout lists 'kits/a', 'kits/b'");

    const listed = runCli({
      args: ['add', '--preset', `file:${lib}`, '--lib', 'tax', '--dir', 'kits/a'],
      cwd: repo,
      env: ENV,
    });

    expect(listed.code, listed.stderr).toBe(0);
    const listedLayout = await layoutOf({ root: repo });

    expect(listedLayout?.shared).toEqual(['kits/a', 'kits/b']);
  });
});

describe('vulcan add --lib says why a folder it used was not recorded', () => {
  const lib = `file:${join(FIXTURES, 'preset-with-lib')}`;
  const project = (): string => {
    const parent = createProject({ files: {} });
    const init = runCli({
      args: [
        'init',
        '--preset',
        lib,
        '--project',
        'p',
        '--key',
        'TEST',
        '--backend-dir',
        'backends',
        '--app',
        'core-api',
        '--shared-dir',
        'kits',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(init.code, init.stderr).toBe(0);

    return join(parent, 'p');
  };
  const addLib = (opts: { root: string; name: string; dir: string }) =>
    runCli({
      args: ['add', '--preset', lib, '--lib', opts.name, '--dir', opts.dir],
      cwd: opts.root,
      env: ENV,
    });

  test.each([
    ['libs/UI', 'lowercase letters'],
    ['kits/deep', 'are nested'],
    ['a/b/c/d/e', 'more than 4 segments'],
    ['backends', "names 'backends' again"],
  ])('--dir %s is used, not recorded, and the reason is said', async (dir, why) => {
    const root = project();
    const result = addLib({ root, name: 'money', dir });

    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(join(root, dir, 'money/package.json'))).toBe(true);
    expect(result.stderr).toContain(`note: '${dir}' is not added to layout.shared`);
    expect(result.stderr).toContain(why);
    expect(result.stderr).toContain('guard-package does not cover it');
    const layout = await layoutOf({ root });

    expect(layout?.shared).toBe('kits');
  });

  test('a listed folder and a valid new one print no note', async () => {
    const root = project();
    const listed = addLib({ root, name: 'money', dir: 'kits' });
    const added = addLib({ root, name: 'tax', dir: 'kits2/b' });

    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stderr).not.toContain('note:');
    expect(added.code, added.stderr).toBe(0);
    expect(added.stderr).not.toContain('note:');
    const layout = await layoutOf({ root });

    expect(layout?.shared).toEqual(['kits', 'kits2/b']);
  });
});

/** A project shaped like a downstream one: grouped apps and libraries, and four folders the layout does not manage. */
const groupedProject = (opts: { other?: string[]; extraPackage?: string } = {}): string => {
  const packages = [
    ['api', 'backends/api'],
    ['merchant', 'frontends/apps/merchant'],
    ['guest', 'frontends/guests/guest'],
    ['site', 'frontends/public/site'],
    ['money', 'frontends/kits/money'],
    ['linter', 'frontends/tools/linter'],
    ['wiki', 'docs/wiki'],
    ['tests', 'qc/tests'],
    ['left-pad', 'third-parties/left-pad'],
    ...(opts.extraPackage === undefined ? [] : [['stray', opts.extraPackage]]),
  ];
  const entries = packages
    .map(
      ([dir, path]) =>
        `{ dir: '${dir}', name: '${dir}', path: '${path}'${path.includes('/kits/') ? ", kind: 'lib'" : ''} }`,
    )
    .join(', ');
  const other = JSON.stringify(opts.other ?? ['frontends/tools', 'docs', 'qc', 'third-parties']);
  const files: Record<string, string> = {
    '.configs/vulcan.config.mts': `export default { layout: { backend: 'backends', frontend: ['frontends/apps', 'frontends/guests', 'frontends/public'], shared: 'frontends/kits', other: ${other} }, packages: [${entries}] };\n`,
    'package.json': JSON.stringify({
      name: 'grouped',
      private: true,
      workspaces: [
        'backends/*',
        'frontends/apps/*',
        'frontends/guests/*',
        'frontends/public/*',
        'frontends/kits/*',
      ],
    }),
  };

  return createProject({ files });
};

const appsViolations = async (opts: { root: string }): Promise<string[]> => {
  const checks = await DoctorRunner.runChecks({ root: opts.root });

  return checks
    .filter((violation) => violation.check === DoctorChecks.APPS)
    .map((violation) => violation.message);
};

describe('doctor on a grouped monorepo', () => {
  test('every folder of every list is a workspace, and packages under other are allowed', async () => {
    const result = await appsViolations({ root: groupedProject() });
    expect(result).toEqual([]);
  });

  test('without the other folders every package outside a side is reported, as on 0.4.3', async () => {
    const violations = await appsViolations({ root: groupedProject({ other: ['docs'] }) });

    expect(
      violations.filter((message) => message.includes('outside every layout folder')),
    ).toHaveLength(3);
  });

  test('a stray package under no folder is still reported', async () => {
    const violations = await appsViolations({
      root: groupedProject({ extraPackage: 'elsewhere/stray' }),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(
      'package stray lives at elsewhere/stray, outside every layout folder',
    );
  });

  test('a listed side folder that is not a workspace is reported; an other folder need not be one', async () => {
    const root = groupedProject();

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'grouped',
        private: true,
        workspaces: ['backends/*', 'frontends/apps/*', 'frontends/kits/*'],
      }),
    );

    const violations = await appsViolations({ root });

    expect(
      violations.filter((message) => message.startsWith("layout.frontend 'frontends/guests'")),
    ).toHaveLength(1);
    expect(
      violations.filter((message) => message.startsWith("layout.frontend 'frontends/public'")),
    ).toHaveLength(1);
    expect(violations.some((message) => message.includes('layout.other'))).toBe(false);
  });
});

describe('doctor and workspace globs', () => {
  test('a negation glob covers nothing: the folders it does not name are still reported', async () => {
    const root = groupedProject();

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'grouped',
        private: true,
        workspaces: ['backends/*', 'frontends/kits/*', '!backends/legacy'],
      }),
    );

    const violations = await appsViolations({ root });

    expect(violations.filter((message) => message.startsWith("layout.frontend '"))).toHaveLength(3);
  });

  test('a package that is an other folder itself (a docs site at docs) is allowed', async () => {
    const result = await appsViolations({ root: groupedProject({ extraPackage: 'docs' }) });
    expect(result).toEqual([]);
  });

  test('a glob that matches a package in the folder covers it, as frontends/*/* covers frontends/apps', async () => {
    const root = groupedProject();

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'grouped',
        private: true,
        workspaces: { packages: ['backends/*', 'frontends/*/*'] },
      }),
    );

    const result = await appsViolations({ root });
    expect(result).toEqual([]);
  });
});

describe('preset diff for an app in a later folder of a list', () => {
  test('the side of the app is found in any folder', () => {
    const root = monorepo({ backendDir: 'backends' });

    runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'backends-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    const result = runCli({ args: ['preset', 'diff', 'worker', '--check'], cwd: root, env: ENV });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('backends-2/worker against');
  });
});
