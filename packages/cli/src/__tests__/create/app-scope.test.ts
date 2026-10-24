import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { driveTerminal, KEYS } from '../terminal.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND = `file:${join(FIXTURES, 'preset-backend')}`;
const FRONTEND = `file:${join(FIXTURES, 'preset-frontend')}`;
const ENV = { VULCAN_NO_INSTALL: '1' };
const hasScript = Bun.which('script') !== null;
const INIT = [
  'init',
  '--preset',
  BACKEND,
  '--project',
  'p',
  '--backend-dir',
  'services',
  '--app',
  'core-api',
];

const nameOf = (opts: { root: string; path: string }): string =>
  JSON.parse(readFileSync(join(opts.root, opts.path, 'package.json'), 'utf8')).name;

const registered = (opts: { root: string }): string =>
  readFileSync(join(opts.root, '.configs/vulcan.config.mts'), 'utf8');

const monorepo = (opts: { scope?: string } = {}): string => {
  const parent = createProject({ files: {} });

  runCli({
    args: [...INIT, ...(opts.scope === undefined ? [] : ['--scope', opts.scope])],
    cwd: parent,
    env: ENV,
  });

  return join(parent, 'p');
};

describe('vulcan init --scope', () => {
  test('names the first app @scope/<app>; the folder and the registered dir stay bare', () => {
    const root = monorepo({ scope: '@nx-app' });

    expect(nameOf({ root, path: 'services/core-api' })).toBe('@nx-app/core-api');
    expect(existsSync(join(root, 'services/core-api'))).toBe(true);
    expect(registered({ root })).toContain('"name": "@nx-app/core-api"');
    expect(registered({ root })).toContain('"dir": "core-api"');
    expect(registered({ root })).toContain('"path": "services/core-api"');
  });

  test('without --scope the package name is the bare app name, as before', () => {
    const root = monorepo();

    expect(nameOf({ root, path: 'services/core-api' })).toBe('core-api');
  });

  test('a scope that is not one is refused before anything is written', () => {
    const parent = createProject({ files: {} });
    const result = runCli({ args: [...INIT, '--scope', 'nx-app'], cwd: parent, env: ENV });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--scope 'nx-app' is not a scope like @acme");
    expect(existsSync(join(parent, 'p'))).toBe(false);
  });
});

describe('vulcan add --app --scope', () => {
  test('names the new app @scope/<app> and registers it with a bare dir and folder', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'worker', '--scope', '@nx-app'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(nameOf({ root, path: 'services/worker' })).toBe('@nx-app/worker');
    expect(registered({ root })).toContain('"name": "@nx-app/worker"');
    expect(registered({ root })).toContain('"dir": "worker"');
    expect(registered({ root })).toContain('"path": "services/worker"');
  });

  test('without --scope the app is named as before, whatever scope the other apps have', () => {
    const root = monorepo({ scope: '@nx-app' });

    runCli({ args: ['add', '--preset', BACKEND, '--app', 'worker'], cwd: root, env: ENV });

    expect(nameOf({ root, path: 'services/worker' })).toBe('worker');
  });

  test('a frontend with a scope still proxies to a backend named by its bare dir', () => {
    const root = monorepo({ scope: '@nx-app' });
    const result = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'apps',
        '--app',
        'web',
        '--scope',
        '@nx-app',
        '--api',
        'core-api',
      ],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(nameOf({ root, path: 'apps/web' })).toBe('@nx-app/web');
  });

  test('a scope that is not one is refused and nothing is written', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'worker', '--scope', 'nx-app'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--scope 'nx-app' is not a scope like @acme");
    expect(existsSync(join(root, 'services/worker'))).toBe(false);
  });

  test('a package name that exists already is refused', () => {
    const root = monorepo({ scope: '@nx-app' });
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'core-api2', '--scope', '@nx-app'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);

    const again = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'core-api2', '--scope', '@nx-app'],
      cwd: root,
      env: ENV,
    });

    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already exists');
  });
});

describe('--scope is in the help text for apps too', () => {
  test('init --preset and add --app list it', () => {
    const help = runCli({ args: ['help'], cwd: createProject({ files: {} }) }).stdout;

    expect(help).toMatch(/init --preset[^\n]*\n[^\n]*--scope <@scope>/);
    expect(help).toMatch(/--scope names the package\s+@scope\/<name>/);
  });
});

describe.skipIf(!hasScript)(
  'the menus ask for a scope, optional, only where menus are drawn',
  () => {
    const MENU_ENV = { ...ENV, TERM: 'xterm-256color' };

    test('init: a typed scope names the app, an empty answer leaves it bare', async () => {
      const parent = createProject({ files: {} });
      const result = await driveTerminal({
        args: ['init', '--preset', BACKEND],
        cwd: parent,
        env: MENU_ENV,
        steps: [
          { waitFor: 'Project name', send: `p${KEYS.ENTER}` },
          { waitFor: 'Backend folder', send: `services${KEYS.ENTER}` },
          { waitFor: 'Name of this backend app', send: `core-api${KEYS.ENTER}` },
          { waitFor: 'Shared code folder', send: KEYS.ENTER },
          { waitFor: 'Package scope', send: `@nx-app${KEYS.ENTER}` },
          { waitFor: 'Write these files?', send: KEYS.ENTER },
          { waitFor: 'Tell VULCAN how you like to work', send: `n${KEYS.ENTER}` },
        ],
      });

      expect(result.code).toBe(0);
      expect(result.plain).toContain('@nx-app/core-api');
      expect(nameOf({ root: join(parent, 'p'), path: 'services/core-api' })).toBe(
        '@nx-app/core-api',
      );
    });

    test('add: Enter on the scope question keeps the bare name', async () => {
      const root = monorepo();
      const result = await driveTerminal({
        args: ['add', '--preset', BACKEND],
        cwd: root,
        env: MENU_ENV,
        steps: [
          { waitFor: 'Name of this backend app', send: `worker${KEYS.ENTER}` },
          { waitFor: 'Package scope', send: KEYS.ENTER },
          { waitFor: 'Write these files?', send: KEYS.ENTER },
        ],
      });

      expect(result.code).toBe(0);
      expect(nameOf({ root, path: 'services/worker' })).toBe('worker');
    });

    test('a scope that is not one is refused where it is typed', async () => {
      const root = monorepo();
      const result = await driveTerminal({
        args: ['add', '--preset', BACKEND],
        cwd: root,
        env: MENU_ENV,
        steps: [
          { waitFor: 'Name of this backend app', send: `worker${KEYS.ENTER}` },
          { waitFor: 'Package scope', send: `nx-app${KEYS.ENTER}` },
          { waitFor: 'is not a scope', send: KEYS.CTRL_C },
        ],
      });

      expect(result.code).toBe(1);
      expect(existsSync(join(root, 'services/worker'))).toBe(false);
    });
  },
);
