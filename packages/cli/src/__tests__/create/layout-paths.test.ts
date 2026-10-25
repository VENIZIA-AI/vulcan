import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  layoutFolderProblem,
  layoutKeyOfFolder,
  layoutOverlapProblems,
  layoutProblems,
  validLayoutFolders,
  withLayoutFolder,
} from '../../common/layout-folder.ts';
import { loadConfig } from '../../config/index.ts';
import { DoctorChecks, runDoctorChecks } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND = `file:${join(FIXTURES, 'preset-backend')}`;
const FRONTEND = `file:${join(FIXTURES, 'preset-frontend')}`;
const ENV = { VULCAN_NO_INSTALL: '1' };

describe('layoutFolderProblem', () => {
  test.each(['services', 'auroras/apps', 'a/b/c/d', 'web-2/app1', '0/1'])(
    '%s is a folder',
    (folder) => {
      expect(layoutFolderProblem({ folder })).toBeUndefined();
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
    expect(layoutFolderProblem({ folder })).toContain(why);
  });

  test('something that is not a string is not a folder', () => {
    expect(layoutFolderProblem({ folder: 7 })).toBeDefined();
    expect(layoutFolderProblem({ folder: null })).toBeDefined();
  });
});

describe('the layout as a whole', () => {
  test('a folder under two keys, or listed twice, is a problem', () => {
    expect(
      layoutOverlapProblems({ layout: { backend: 'a', frontend: ['b', 'a'] } }).join(' '),
    ).toContain("layout.frontend names 'a' again (also layout.backend)");
    expect(layoutOverlapProblems({ layout: { frontend: ['b', 'b'] } })).toHaveLength(1);
  });

  test('a folder inside another, in either order and across keys, is a problem', () => {
    expect(
      layoutOverlapProblems({ layout: { backend: 'auroras', frontend: 'auroras/apps' } }),
    ).toHaveLength(1);
    expect(
      layoutOverlapProblems({ layout: { frontend: ['auroras/apps', 'auroras'] } }),
    ).toHaveLength(1);
    expect(layoutOverlapProblems({ layout: { shared: 'a/b', other: 'a/b/c' } })).toHaveLength(1);
    // A shared prefix is not nesting.
    expect(
      layoutOverlapProblems({ layout: { backend: 'auroras/apps', frontend: 'auroras/apps2' } }),
    ).toEqual([]);
  });

  test('layoutProblems adds the folders that are not folders, and skips them in the overlaps', () => {
    const problems = layoutProblems({ layout: { backend: ['../x', 'a'], frontend: 'a' } });

    expect(problems.some((problem) => problem.startsWith('layout.backend: '))).toBe(true);
    expect(problems.some((problem) => problem.includes("names 'a' again"))).toBe(true);
  });

  test('a string grows into a list, a listed folder changes nothing, none makes a string', () => {
    expect(withLayoutFolder({ value: undefined, folder: 'a' })).toBe('a');
    expect(withLayoutFolder({ value: 'a', folder: 'a' })).toBe('a');
    expect(withLayoutFolder({ value: 'a', folder: 'b' })).toEqual(['a', 'b']);
    expect(withLayoutFolder({ value: ['a', 'b'], folder: 'b' })).toEqual(['a', 'b']);
    expect(withLayoutFolder({ value: ['a', 'b'], folder: 'c' })).toEqual(['a', 'b', 'c']);
  });

  test('the key of a folder is the exact folder, and only a valid one counts', () => {
    const layout = { backend: 'umbras', frontend: ['auroras/apps', '../bad'], other: 'docs' };

    expect(layoutKeyOfFolder({ layout, folder: 'auroras/apps' })).toBe('frontend');
    expect(layoutKeyOfFolder({ layout, folder: 'docs' })).toBe('other');
    expect(layoutKeyOfFolder({ layout, folder: 'auroras' })).toBeUndefined();
    expect(layoutKeyOfFolder({ layout, folder: '../bad' })).toBeUndefined();
    expect(validLayoutFolders({ value: ['a', 7, '../x', 'b/c'] })).toEqual(['a', 'b/c']);
  });
});

const configOf = async (opts: { layout: string }) => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.ts': `export default { layout: ${opts.layout} };\n`,
    },
  });

  return loadConfig({ root });
};

describe('the config schema', () => {
  test('a string, a list and other are accepted', async () => {
    const result = await configOf({
      layout:
        "{ backend: 'umbras', frontend: ['auroras/apps', 'auroras/guests'], shared: 'auroras/kits', other: ['docs', 'qc'] }",
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.config.layout?.frontend : undefined).toEqual([
      'auroras/apps',
      'auroras/guests',
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
      '--backend-dir',
      opts.backendDir ?? 'umbras',
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
  const loaded = await loadConfig({ root: opts.root });

  return loaded.ok ? loaded.config.layout : undefined;
};

describe('vulcan init --preset with folder paths', () => {
  test('a backend folder and a shared folder two levels deep', async () => {
    const root = monorepo({ backendDir: 'auroras/apps', shared: 'auroras/kits' });

    expect(existsSync(join(root, 'auroras/apps/core-api/package.json'))).toBe(true);
    expect(await layoutOf({ root })).toEqual({ backend: 'auroras/apps', shared: 'auroras/kits' });
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('auroras/apps/*');
  });

  test.each([
    [['--backend-dir', '../up'], 'climbs'],
    [['--backend-dir', 'a/node_modules/b'], 'node_modules'],
    [['--backend-dir', 'auroras', '--shared-dir', 'auroras/kits'], 'nested'],
    [['--backend-dir', 'a/b/c/d/e'], 'more than 4'],
  ])('%j is refused before anything is written', (flags, why) => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: ['init', '--preset', BACKEND, '--project', 'p', '--app', 'core-api', ...flags],
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
    const root = monorepo({ backendDir: 'umbras' });
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras-2/services', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(join(root, 'umbras-2/services/worker/package.json'))).toBe(true);
    expect((await layoutOf({ root }))?.backend).toEqual(['umbras', 'umbras-2/services']);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('umbras-2/services/*');
  });

  test('with several folders listed the flag is required, and the error lists them', async () => {
    const root = monorepo({ backendDir: 'umbras' });

    runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    const missing = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'job'],
      cwd: root,
      env: ENV,
    });
    const listed = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras-2', '--app', 'job'],
      cwd: root,
      env: ENV,
    });
    const first = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras', '--app', 'queue'],
      cwd: root,
      env: ENV,
    });

    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('missing --backend-dir');
    expect(missing.stderr).toContain("the layout lists 'umbras', 'umbras-2'");
    expect(listed.code, listed.stderr).toBe(0);
    expect(first.code, first.stderr).toBe(0);
    // A folder that is listed already changes nothing in the layout.
    expect((await layoutOf({ root }))?.backend).toEqual(['umbras', 'umbras-2']);
    expect(existsSync(join(root, 'umbras/queue/package.json'))).toBe(true);
  });

  test('the hand-added lines show the list when the apps block cannot be extended', () => {
    const root = monorepo({ backendDir: 'umbras' });
    const config = join(root, '.configs/vulcan.config.mts');

    writeFileSync(config, readFileSync(config, 'utf8').replace('// vulcan:apps:start', '// gone'));

    const result = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("layout: { backend: ['umbras', 'umbras-2'] },");
  });

  test('a folder listed under other is not an app target, and the error says so', async () => {
    const root = monorepo({ backendDir: 'umbras' });
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
    const root = monorepo({ backendDir: 'umbras', shared: 'kits' });
    const cases: [string, string][] = [
      ['../up', 'climbs'],
      ['umbras/deeper', 'nested'],
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
    expect((await layoutOf({ root }))?.backend).toBe('umbras');
  });

  test('a frontend finds its backend in any folder of the backend list', async () => {
    const root = monorepo({ backendDir: 'umbras' });

    runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    const result = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'auroras/apps',
        '--app',
        'web',
        '--api',
        'worker',
      ],
      cwd: root,
      env: ENV,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(readFileSync(join(root, 'auroras/apps/web/vite.config.ts'), 'utf8')).toContain(
      'localhost:',
    );
    expect((await layoutOf({ root }))?.frontend).toBe('auroras/apps');
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
        '--backend-dir',
        'umbras',
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
    expect((await layoutOf({ root: repo }))?.shared).toEqual(['kits/a', 'kits/b']);

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
    expect((await layoutOf({ root: repo }))?.shared).toEqual(['kits/a', 'kits/b']);
  });
});

/** A project shaped like BANA's: grouped apps and libraries, and four folders the layout does not manage. */
const groupedProject = (opts: { other?: string[]; extraPackage?: string } = {}): string => {
  const packages = [
    ['api', 'umbras/api'],
    ['merchant', 'auroras/apps/merchant'],
    ['guest', 'auroras/guests/guest'],
    ['site', 'auroras/public/site'],
    ['money', 'auroras/kits/money'],
    ['linter', 'auroras/tools/linter'],
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
  const other = JSON.stringify(opts.other ?? ['auroras/tools', 'docs', 'qc', 'third-parties']);
  const files: Record<string, string> = {
    '.configs/vulcan.config.ts': `export default { layout: { backend: 'umbras', frontend: ['auroras/apps', 'auroras/guests', 'auroras/public'], shared: 'auroras/kits', other: ${other} }, packages: [${entries}] };\n`,
    'package.json': JSON.stringify({
      name: 'grouped',
      private: true,
      workspaces: [
        'umbras/*',
        'auroras/apps/*',
        'auroras/guests/*',
        'auroras/public/*',
        'auroras/kits/*',
      ],
    }),
  };

  return createProject({ files });
};

const appsViolations = async (opts: { root: string }): Promise<string[]> =>
  (await runDoctorChecks({ root: opts.root }))
    .filter((violation) => violation.check === DoctorChecks.APPS)
    .map((violation) => violation.message);

describe('doctor on a grouped monorepo', () => {
  test('every folder of every list is a workspace, and packages under other are allowed', async () => {
    expect(await appsViolations({ root: groupedProject() })).toEqual([]);
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
        workspaces: ['umbras/*', 'auroras/apps/*', 'auroras/kits/*'],
      }),
    );

    const violations = await appsViolations({ root });

    expect(
      violations.filter((message) => message.startsWith("layout.frontend 'auroras/guests'")),
    ).toHaveLength(1);
    expect(
      violations.filter((message) => message.startsWith("layout.frontend 'auroras/public'")),
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
        workspaces: ['umbras/*', 'auroras/kits/*', '!umbras/legacy'],
      }),
    );

    const violations = await appsViolations({ root });

    expect(violations.filter((message) => message.startsWith("layout.frontend '"))).toHaveLength(3);
  });

  test('a package that is an other folder itself (a docs site at docs) is allowed', async () => {
    expect(await appsViolations({ root: groupedProject({ extraPackage: 'docs' }) })).toEqual([]);
  });

  test('a glob that matches a package in the folder covers it, as auroras/*/* covers auroras/apps', async () => {
    const root = groupedProject();

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'grouped',
        private: true,
        workspaces: { packages: ['umbras/*', 'auroras/*/*'] },
      }),
    );

    expect(await appsViolations({ root })).toEqual([]);
  });
});

describe('preset diff for an app in a later folder of a list', () => {
  test('the side of the app is found in any folder', () => {
    const root = monorepo({ backendDir: 'umbras' });

    runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'umbras-2', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    const result = runCli({ args: ['preset', 'diff', 'worker', '--check'], cwd: root, env: ENV });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('umbras-2/worker against');
  });
});
