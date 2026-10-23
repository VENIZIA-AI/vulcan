import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkManifests } from '../format.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const WITH_LIB = `file:${join(FIXTURES, 'preset-with-lib')}`;
const APP_ONLY = `file:${join(FIXTURES, 'preset-backend')}`;
const ENV = { VULCAN_NO_INSTALL: '1' };
const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const hasScript = Bun.which('script') !== null;

/** A monorepo made by init from the preset that also makes libraries, with a shared folder `libs`. */
const monorepo = (opts: { project?: string; shared?: string } = {}): string => {
  const parent = createProject({ files: {} });
  const project = opts.project ?? 'p';

  runCli({
    args: [
      'init',
      '--preset',
      WITH_LIB,
      '--project',
      project,
      '--backend-dir',
      'services',
      '--app',
      'core-api',
      ...(opts.shared === undefined
        ? ['--shared-dir', 'libs']
        : opts.shared === ''
          ? []
          : ['--shared-dir', opts.shared]),
    ],
    cwd: parent,
    env: ENV,
  });

  return join(parent, project);
};

const addLib = (opts: { root: string; args: string[]; preset?: string }) =>
  runCli({
    args: ['add', '--preset', opts.preset ?? WITH_LIB, ...opts.args],
    cwd: opts.root,
    env: ENV,
  });

const readJson = (opts: { root: string; path: string }) =>
  JSON.parse(readFileSync(join(opts.root, opts.path), 'utf8'));

describe('vulcan add --lib', () => {
  test('every package.json is sorted for bun fmt right after init and after add', () => {
    const root = monorepo();

    expect(checkManifests({ root }).code, checkManifests({ root }).output).toBe(0);

    addLib({ root, args: ['--lib', 'billing'] });

    expect(checkManifests({ root }).code, checkManifests({ root }).output).toBe(0);
  });

  test('creates the package in the shared folder, from the lib preset', () => {
    const root = monorepo();
    const result = addLib({ root, args: ['--lib', 'billing'] });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('created  libs/billing/package.json');
    expect(readFileSync(join(root, 'libs/billing/src/index.ts'), 'utf8')).toBe(
      "export const name = 'billing';\nexport const lib = 'billing';\nexport const project = 'p';\n",
    );
    expect(readFileSync(join(root, 'libs/billing/README.md'), 'utf8')).toBe('# billing\n');
  });

  test('package.json: name, generated fields, catalog ranges, verbatim fields', () => {
    const root = monorepo();

    addLib({ root, args: ['--lib', 'billing'] });

    expect(readJson({ root, path: 'libs/billing/package.json' })).toEqual({
      name: 'billing',
      version: '0.0.0',
      private: true,
      type: 'module',
      sideEffects: false,
      exports: { '.': './src/index.ts' },
      imports: { '#src/*': './src/*.js' },
      scripts: { typecheck: 'bun -e 0', lint: 'bun -e 0', test: 'bun -e 0' },
      dependencies: { zod: 'catalog:' },
      devDependencies: { typescript: 'catalog:' },
      peerDependencies: { '@fixture/lib': 'catalog:' },
    });
  });

  test('the ranges join the root catalog, and a version the monorepo already pins wins', () => {
    const root = monorepo();
    const manifest = readJson({ root, path: 'package.json' });
    const catalog = manifest.workspaces.catalog;

    expect(catalog.typescript).toBe('^6.0.3');

    addLib({ root, args: ['--lib', 'billing'] });

    const after = readJson({ root, path: 'package.json' }).workspaces.catalog;

    expect(after.zod).toBe('^4.0.0');
    expect(after.typescript).toBe('^6.0.3');
    expect(after['@fixture/lib']).toBe('1.0.0');
  });

  test('is registered as a lib package with its path, and the preset is recorded with its lib summary', () => {
    const root = monorepo();

    addLib({ root, args: ['--lib', 'billing'] });
    runCli({ args: ['sync', '--agents', 'none'], cwd: root });

    const manifest = readJson({ root, path: '.agents/vulcan.manifest.json' });

    expect(manifest.packages.find((item: { dir: string }) => item.dir === 'billing')).toMatchObject(
      {
        name: 'billing',
        path: 'libs/billing',
        kind: 'lib',
      },
    );
    expect(manifest.presets[0].lib).toBe('A fixture library.');
  });

  test('the knowledge page, the index line and the log entry are written', () => {
    const root = monorepo();

    addLib({ root, args: ['--lib', 'billing'] });

    const page = readFileSync(join(root, '.agents/knowledge/packages/billing.md'), 'utf8');

    expect(page).toContain('resource: libs/billing');
    expect(page).toContain('tags: [packages, library]');
    expect(page).toContain('The shared package at `libs/billing`');
    expect(readFileSync(join(root, '.agents/knowledge/index.md'), 'utf8')).toContain(
      '[billing](packages/billing.md)',
    );
    expect(existsSync(join(root, '.agents/knowledge/log.md'))).toBe(false);
  });

  test('ends with Done and the install, sync and checks lines', () => {
    const root = monorepo();
    const result = addLib({ root, args: ['--lib', 'billing'] });

    expect(result.stderr).toContain('skipped  bun install');
    expect(result.stderr).toContain('skipped  bun run typecheck');
    expect(result.stderr).toContain('Done. libs/billing is added.');
  });

  test('doctor passes with the new package', () => {
    const root = monorepo();

    addLib({ root, args: ['--lib', 'billing'] });
    runCli({ args: ['sync', '--agents', 'none'], cwd: root });

    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('[apps]');
  });
});

describe('where it goes', () => {
  test('--dir names the folder, nested or not, and the workspaces learn it', () => {
    const root = monorepo({ shared: '' });
    const result = addLib({ root, args: ['--lib', 'merchant', '--dir', 'auroras/features'] });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'auroras/features/merchant/package.json'))).toBe(true);
    expect(readJson({ root, path: 'package.json' }).workspaces.packages).toContain(
      'auroras/features/*',
    );
  });

  test('without --dir the shared folder of the layout is used', () => {
    const root = monorepo({ shared: 'shared-code' });

    addLib({ root, args: ['--lib', 'billing'] });

    expect(existsSync(join(root, 'shared-code/billing/package.json'))).toBe(true);
  });

  test('without --dir and without a shared folder, the common folder of the existing libs is used', () => {
    const root = monorepo({ shared: '' });

    addLib({ root, args: ['--lib', 'first', '--dir', 'auroras/features'] });
    const result = addLib({ root, args: ['--lib', 'second'] });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'auroras/features/second/package.json'))).toBe(true);
  });

  test('with nothing to go on it stops and asks for --dir', () => {
    const root = monorepo({ shared: '' });
    const result = addLib({ root, args: ['--lib', 'billing'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('vulcan add: where should billing go? pass --dir <folder>');
    expect(existsSync(join(root, 'billing'))).toBe(false);
  });

  test('libs in two folders: --dir is required, not guessed', () => {
    const root = monorepo({ shared: '' });

    addLib({ root, args: ['--lib', 'a', '--dir', 'auroras/features'] });
    addLib({ root, args: ['--lib', 'b', '--dir', 'auroras/tools'] });

    const result = addLib({ root, args: ['--lib', 'c'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('pass --dir <folder>');
  });
});

describe('the package name', () => {
  const scoped = (opts: { names: string[]; project?: string }): string => {
    const root = monorepo({ project: opts.project });
    const config = join(root, '.configs/vulcan.config.mts');

    // Libraries already in the folder, as a project that has them would hold them.
    for (const name of opts.names) {
      const dir = name.replace(/^@[^/]+\//, '');

      mkdirSync(join(root, 'libs', dir), { recursive: true });
      writeFileSync(join(root, 'libs', dir, 'package.json'), JSON.stringify({ name }));
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          '"packages": [',
          `"packages": [\n    { "dir": "${dir}", "name": "${name}", "path": "libs/${dir}", "kind": "lib" },`,
        ),
      );
    }

    return root;
  };

  test('unscoped when nothing says otherwise', () => {
    const root = monorepo();

    addLib({ root, args: ['--lib', 'billing'] });

    expect(readJson({ root, path: 'libs/billing/package.json' }).name).toBe('billing');
  });

  test('the scope the sibling packages agree on', () => {
    const root = scoped({ names: ['@nx-feature/orders', '@nx-feature/stock'] });

    addLib({ root, args: ['--lib', 'merchant'] });

    expect(readJson({ root, path: 'libs/merchant/package.json' }).name).toBe(
      '@nx-feature/merchant',
    );
  });

  test('siblings that disagree: refuse and ask for --scope, nothing written', () => {
    const root = scoped({ names: ['@a/orders', '@b/stock'] });
    const result = addLib({ root, args: ['--lib', 'merchant'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'the packages in libs use more than one scope (@a, @b) - pass --scope <@scope>',
    );
    expect(existsSync(join(root, 'libs/merchant'))).toBe(false);
  });

  test('--scope wins', () => {
    const root = scoped({ names: ['@a/orders', '@b/stock'] });

    addLib({ root, args: ['--lib', 'merchant', '--scope', '@c'] });

    expect(readJson({ root, path: 'libs/merchant/package.json' }).name).toBe('@c/merchant');
  });

  test("the project's own scope when the folder has no siblings", () => {
    const root = monorepo();
    const file = join(root, 'package.json');

    writeFileSync(
      file,
      JSON.stringify({ ...readJson({ root, path: 'package.json' }), name: '@acme/p-workspace' }),
    );
    addLib({ root, args: ['--lib', 'billing'] });

    expect(readJson({ root, path: 'libs/billing/package.json' }).name).toBe('@acme/billing');
  });

  test('a scope that is not @name is refused', () => {
    const root = monorepo();

    expect(addLib({ root, args: ['--lib', 'billing', '--scope', 'acme'] }).stderr).toContain(
      "--scope 'acme' is not a scope like @acme",
    );
  });
});

describe('refusals', () => {
  test('a preset with no lib kind', () => {
    const root = monorepo();
    const result = addLib({ root, preset: APP_ONLY, args: ['--lib', 'billing'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('vulcan add: preset @fixture/backend has no lib kind');
    expect(existsSync(join(root, 'libs/billing'))).toBe(false);
  });

  test('--app and --lib together', () => {
    const result = addLib({ root: monorepo(), args: ['--lib', 'billing', '--app', 'x'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--app and --lib cannot be used together');
  });

  test('a name that is not lowercase letters, digits and -', () => {
    const result = addLib({ root: monorepo(), args: ['--lib', 'Billing'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("'Billing' is not a name");
  });

  test('a package that is already there', () => {
    const root = monorepo();

    addLib({ root, args: ['--lib', 'billing'] });

    const again = addLib({ root, args: ['--lib', 'billing'] });

    expect(again.code).toBe(1);
    expect(again.stderr).toContain('libs/billing already exists');
  });
});

describe('the contract of lib.json', () => {
  const withLib = (opts: {
    change: (lib: Record<string, unknown>) => Record<string, unknown>;
  }): string => {
    const folder = createProject({ files: {} });
    const source = join(FIXTURES, 'preset-with-lib');

    Bun.spawnSync(['cp', '-r', `${source}/.`, folder]);

    const file = join(folder, 'vulcan-preset/lib.json');

    writeFileSync(file, JSON.stringify(opts.change(JSON.parse(readFileSync(file, 'utf8')))));

    return `file:${folder}`;
  };

  test('packageFields may only be type, sideEffects, browser, engines', () => {
    const preset = withLib({ change: lib => ({ ...lib, packageFields: { license: 'MIT' } }) });
    const result = addLib({ root: monorepo(), preset, args: ['--lib', 'billing'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'packageFields.license is not allowed - one of: type, sideEffects, browser, engines',
    );
  });

  test('a field vulcan generates is named as such', () => {
    const preset = withLib({ change: lib => ({ ...lib, packageFields: { exports: {} } }) });

    expect(addLib({ root: monorepo(), preset, args: ['--lib', 'billing'] }).stderr).toContain(
      'packageFields.exports is generated by vulcan - declare it in exports instead',
    );
  });

  test('imports keys start with #, checks are keys of scripts', () => {
    const imports = withLib({ change: lib => ({ ...lib, imports: { 'src/*': './src/*.js' } }) });
    const checks = withLib({ change: lib => ({ ...lib, checks: ['nope'] }) });

    expect(addLib({ root: monorepo(), preset: imports, args: ['--lib', 'b'] }).stderr).toContain(
      'imports',
    );
    expect(addLib({ root: monorepo(), preset: checks, args: ['--lib', 'b'] }).stderr).toContain(
      '"nope" is not a key of scripts',
    );
  });

  test('a lib preset with side, devPort or urls is refused: they belong to apps', () => {
    const preset = withLib({ change: lib => ({ ...lib, devPort: 3000 }) });

    expect(addLib({ root: monorepo(), preset, args: ['--lib', 'billing'] }).stderr).toContain(
      'devPort',
    );
  });

  test('the app preset still works from a package that also has a lib kind', () => {
    const root = monorepo();
    const result = addLib({ root, args: ['--app', 'second-api'] });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'services/second-api/package.json'))).toBe(true);
  });
});

describe('add asks which kind when neither flag is given', () => {
  test('without a terminal it refuses, writes nothing and prints both exact commands', () => {
    const root = monorepo();
    const result = addLib({ root, args: [] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'vulcan add: say what to create - `--app <name>` (a runnable app) or `--lib <name>` (a shared package)',
    );
    expect(result.stderr).toContain(
      `bun x --no-install vulcan add --preset ${WITH_LIB} --app <name>`,
    );
    expect(result.stderr).toContain(
      `bun x --no-install vulcan add --preset ${WITH_LIB} --lib <name>`,
    );
    expect(readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8')).not.toContain('billing');
  });

  describe.skipIf(!hasScript)('in a terminal', () => {
    const inTerminal = (opts: { root: string; args: string[]; answers: string[] }) => {
      const command = [process.execPath, CLI, 'add', ...opts.args]
        .map(part => `'${part.replaceAll("'", "'\\''")}'`)
        .join(' ');
      const child = spawnSyncBounded({
        cmd: ['script', '-qec', command, '/dev/null'],
        cwd: opts.root,
        env: { ...process.env, TERM: 'dumb', ...ENV },
        stdin: Buffer.from(`${opts.answers.join('\n')}\n`),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      return { code: child.exitCode, output: child.stdout.toString() };
    };

    test('asks the kind (only the kinds the preset offers), then the name, then the folder with its default', () => {
      const root = monorepo();
      const { code, output } = inTerminal({
        root,
        args: ['--preset', WITH_LIB],
        answers: ['lib', 'billing', ''],
      });

      expect(code).toBe(0);
      expect(output).toContain('What do you want to create? (app, lib)');
      expect(output).toContain('Name of this library');
      expect(output).toContain('Folder (libs)');
      expect(existsSync(join(root, 'libs/billing/package.json'))).toBe(true);
    });

    test('a preset with one kind still asks for the name, not the kind', () => {
      const root = monorepo();
      const { code, output } = inTerminal({
        root,
        args: ['--preset', APP_ONLY],
        answers: ['', 'second-api'],
      });

      expect(code).toBe(0);
      expect(output).not.toContain('What do you want to create?');
      expect(existsSync(join(root, 'services/second-api/package.json'))).toBe(true);
    });

    test('choosing app asks the app questions as before', () => {
      const root = monorepo();
      const { code } = inTerminal({
        root,
        args: ['--preset', WITH_LIB],
        answers: ['app', 'services', 'third-api'],
      });

      expect(code).toBe(0);
      expect(existsSync(join(root, 'services/third-api/package.json'))).toBe(true);
    });
  });
});
