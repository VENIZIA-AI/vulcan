import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppsBlock } from '../../create/workspace.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const WITH_SHARED = `file:${join(FIXTURES, 'preset-with-shared')}`;
const WITH_LIB = `file:${join(FIXTURES, 'preset-with-lib')}`;
const FRONTEND = `file:${join(FIXTURES, 'preset-frontend')}`;
const ENV = { VULCAN_NO_INSTALL: '1' };

const initFrom = (opts: { preset: string; args: string[] }): string => {
  const parent = createProject({ files: {} });
  const result = runCli({
    args: ['init', '--preset', opts.preset, '--project', 'p', ...opts.args],
    cwd: parent,
    env: ENV,
  });

  expect(result.code, result.stderr).toBe(0);

  return join(parent, 'p');
};

/** A monorepo made from the preset that has app, lib and shared kinds, with a shared folder `libs`. */
const monorepo = (): string =>
  initFrom({
    preset: WITH_SHARED,
    args: ['--backend-dir', 'services', '--app', 'core-api', '--shared-dir', 'libs'],
  });

const add = (opts: { root: string; preset?: string; args: string[] }) =>
  runCli({
    args: ['add', '--preset', opts.preset ?? WITH_SHARED, ...opts.args],
    cwd: opts.root,
    env: ENV,
  });

const blockOf = (opts: { root: string }) => {
  const parsed = parseAppsBlock({
    source: readFileSync(join(opts.root, '.configs/vulcan.config.mts'), 'utf8'),
  });

  if (!parsed.ok) {
    throw new Error(`the apps block is ${parsed.reason}`);
  }

  return parsed.block;
};

const readJson = (opts: { root: string; path: string }) =>
  JSON.parse(readFileSync(join(opts.root, opts.path), 'utf8'));

describe('vulcan add --shared', () => {
  test('makes the package in the shared folder from the shared kind, with its own tokens', () => {
    const root = monorepo();
    const result = add({ root, args: ['--shared', 'common'] });

    expect(result.code, result.stderr).toBe(0);
    expect(readFileSync(join(root, 'libs/common/src/index.ts'), 'utf8')).toBe(
      "export const name = 'common';\nexport const shared = 'common';\nexport const project = 'p';\n",
    );
    expect(readFileSync(join(root, 'libs/common/README.md'), 'utf8')).toBe('# common (shared)\n');
    expect(readJson({ root, path: 'libs/common/package.json' })).toMatchObject({
      name: 'common',
      dependencies: { zod: 'catalog:' },
      devDependencies: { typescript: 'catalog:' },
    });
    expect(readFileSync(join(root, '.agents/knowledge/packages/common.md'), 'utf8')).toContain(
      'shared kind',
    );
  });

  test('the config entry says it came from the shared kind, a lib entry says nothing, and the record keeps both summaries', () => {
    const root = monorepo();

    add({ root, args: ['--shared', 'common'] });
    add({ root, args: ['--lib', 'billing'] });

    const block = blockOf({ root });
    const entry = (dir: string) => block.packages.find((item) => item.dir === dir);

    expect(entry('common')).toMatchObject({ kind: 'lib', presetKind: 'shared' });
    expect(entry('billing')).toMatchObject({ kind: 'lib' });
    expect(entry('billing')?.presetKind).toBeUndefined();
    expect(block.presets?.[0]).toMatchObject({
      side: 'backend',
      lib: 'A fixture library.',
      shared: 'A fixture side-neutral package.',
    });
  });

  test('the kinds cannot be combined, and a name is needed', () => {
    const root = monorepo();

    expect(add({ root, args: ['--shared', 'a', '--lib', 'b'] }).stderr).toContain(
      '--app, --lib and --shared cannot be used together',
    );
    expect(add({ root, args: ['--shared'] }).stderr).toContain('--shared needs a name');
  });

  test('without a kind and without a terminal it prints the command of each kind, shared included', () => {
    const result = add({ root: monorepo(), args: [] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`vulcan add --preset ${WITH_SHARED} --shared <name>`);
  });
});

describe('vulcan add --shared with a preset that has no shared kind', () => {
  test('refuses, writes nothing, says what the preset makes, and says no known preset has the kind', () => {
    const root = initFrom({
      preset: WITH_LIB,
      args: ['--backend-dir', 'services', '--app', 'core-api', '--shared-dir', 'libs'],
    });
    const before = readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8');
    const result = add({ root, preset: WITH_LIB, args: ['--shared', 'x'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('has no shared kind (it makes: app and lib)');
    expect(result.stderr).toContain(
      'no preset known to this project or to the official list has one',
    );
    expect(existsSync(join(root, 'libs/x'))).toBe(false);
    expect(readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8')).toBe(before);
  });

  test('names the recorded preset that has a shared kind, with the exact command', () => {
    const root = monorepo();
    const result = add({ root, preset: WITH_LIB, args: ['--shared', 'x'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('has no shared kind');
    expect(result.stderr).toMatch(/a preset with one: run bun x --no-install vulcan add --preset file:\S+ --shared x/);
    expect(existsSync(join(root, 'libs/x'))).toBe(false);
  });
});

describe('vulcan add --shared in a project that has only a frontend app', () => {
  test('works with no backend app, no backend folder and no preset package among the dependencies', () => {
    const root = initFrom({
      preset: FRONTEND,
      args: ['--frontend-dir', 'web', '--app', 'admin', '--no-api', '--shared-dir', 'libs'],
    });
    const result = add({ root, args: ['--shared', 'common'] });

    expect(result.code, result.stderr).toBe(0);

    const root_package = readFileSync(join(root, 'package.json'), 'utf8');
    const created = readFileSync(join(root, 'libs/common/package.json'), 'utf8');

    expect(root_package).not.toContain('@fixture/withshared');
    expect(created).not.toContain('@fixture/withshared');
    expect(blockOf({ root }).layout.backend).toBeUndefined();
    expect(blockOf({ root }).presets?.find((item) => item.spec.includes('preset-with-shared'))).toMatchObject({
      side: 'backend',
      shared: 'A fixture side-neutral package.',
    });
    expect(existsSync(join(root, 'libs/common/src/index.ts'))).toBe(true);
  });
});

describe('the shared folder belongs to the project, whichever preset made the package', () => {
  test('a lib and a shared package land in the same folder, and the layout lists it once', () => {
    const root = monorepo();

    add({ root, args: ['--lib', 'billing'] });
    add({ root, args: ['--shared', 'common'] });

    expect(existsSync(join(root, 'libs/billing/package.json'))).toBe(true);
    expect(existsSync(join(root, 'libs/common/package.json'))).toBe(true);
    expect(blockOf({ root }).layout.shared).toBe('libs');
  });

  test('with two shared folders both kinds ask for --dir, and both take it', () => {
    const root = monorepo();

    expect(add({ root, args: ['--lib', 'billing', '--dir', 'more'] }).code).toBe(0);
    expect(add({ root, args: ['--lib', 'second'] }).stderr).toContain('--dir');
    expect(add({ root, args: ['--shared', 'common'] }).stderr).toContain('--dir');
    expect(add({ root, args: ['--shared', 'common', '--dir', 'more'] }).code).toBe(0);
    expect(existsSync(join(root, 'more/common/package.json'))).toBe(true);
  });
});
