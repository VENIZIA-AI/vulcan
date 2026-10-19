import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND_PATH = join(FIXTURES, 'preset-backend');
const FRONTEND_PATH = join(FIXTURES, 'preset-frontend');
const BACKEND = `file:${BACKEND_PATH}`;
const FRONTEND = `file:${FRONTEND_PATH}`;
const ENV = { VULCAN_NO_INSTALL: '1' };

const monorepo = (): string => {
  const parent = createProject({ files: {} });

  runCli({
    args: [
      'init',
      '--preset',
      BACKEND,
      '--project',
      'p',
      '--backend-dir',
      'services',
      '--app',
      'core-api',
    ],
    cwd: parent,
    env: ENV,
  });

  return join(parent, 'p');
};

describe('vulcan add --preset', () => {
  test('a frontend lands in a new folder, wired to the chosen backend', () => {
    const root = monorepo();
    const result = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'web',
        '--app',
        'admin',
        '--api',
        'core-api',
      ],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, 'web/admin/vite.config.ts'), 'utf8')).toContain(
      "proxy: 'http://localhost:3000'",
    );

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

    expect(manifest.workspaces.packages).toEqual(['services/*', 'web/*']);

    const config = readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8');

    expect(config).toContain('"frontend": "web"');
    expect(config).toContain('"backend": "services"');
    expect(config).toContain('"path": "web/admin"');
    expect(config).toContain('"path": "services/core-api"');
    expect(existsSync(join(root, '.agents/knowledge/packages/admin.md'))).toBe(true);

    const index = readFileSync(join(root, '.agents/knowledge/index.md'), 'utf8');

    expect(index).toContain('[admin](packages/admin.md)');
    expect(index).toContain('[core-api](packages/core-api.md) - A fixture backend.');
    expect(readFileSync(join(root, '.agents/knowledge/log.md'), 'utf8')).toContain('web/admin');
    expect(result.stderr).toContain('skipped  bun install');
    expect(result.stderr).toContain('skipped  vulcan sync');
  });

  test('a second backend reuses the folder the user chose and takes the next port', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, 'services/worker/.env.example'), 'utf8')).toBe(
      'APP_ENV_SERVER_PORT=3001',
    );
  });

  test('an app name already taken is refused', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'core-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('core-api already exists');
  });

  test('edited-away block markers: refused with the lines to add by hand', () => {
    const root = monorepo();
    const edited = "export default { name: 'p', layout: { backend: 'services' } };\n";

    writeFileSync(join(root, '.configs/vulcan.config.mts'), edited);
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'the vulcan:apps block is gone from .configs/vulcan.config.mts - add by hand:',
    );
    expect(result.stderr).toContain("{ dir: 'worker', name: 'worker', path: 'services/worker' }");
    expect(existsSync(join(root, 'services/worker'))).toBe(false);
    expect(readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8')).toBe(edited);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
    expect(existsSync(join(root, '.agents/knowledge/packages/worker.md'))).toBe(false);
  });

  test('a catalog outside the preset peer range is refused naming both versions', () => {
    const root = monorepo();
    const manifestPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    manifest.workspaces.catalog['@fixture/lib'] = '2.0.0';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const before = readFileSync(manifestPath, 'utf8');
    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'the monorepo pins @fixture/lib 2.0.0, but the preset needs ^1.0.0',
    );
    expect(existsSync(join(root, 'web'))).toBe(false);
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
  });

  test('outside a monorepo with a layout, add is refused', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "x" }' } });
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'a'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'vulcan add: run it at the root of a monorepo vulcan init created',
    );
  });

  test('a frontend without --api or --no-api and no terminal is refused naming both', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --api <app> or --no-api');
    expect(existsSync(join(root, 'web'))).toBe(false);
  });

  test('--api names an app that is not a backend app: refused', () => {
    const root = monorepo();
    const result = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'web',
        '--app',
        'admin',
        '--api',
        'nope',
      ],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--api 'nope' is not a backend app");
    expect(existsSync(join(root, 'web'))).toBe(false);
  });

  test('a folder that differs from the one the config holds for that side is refused', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--backend-dir', 'apps', '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("backend folder is 'services'");
    expect(existsSync(join(root, 'apps'))).toBe(false);
  });

  test('a missing app name is an error naming --app and nothing is written', () => {
    const root = monorepo();
    const result = runCli({ args: ['add', '--preset', BACKEND], cwd: root, env: ENV });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --app');
  });

  test('an npm preset outside the peer range leaves the monorepo untouched', () => {
    const root = monorepo();
    const manifestPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    manifest.workspaces.catalog['@fixture/lib'] = '2.0.0';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const before = readFileSync(manifestPath, 'utf8');
    const result = runCli({
      args: [
        'add',
        '--preset',
        `@fixture/frontend@${FRONTEND}`,
        '--frontend-dir',
        'web',
        '--app',
        'admin',
        '--no-api',
      ],
      cwd: root,
      env: { VULCAN_NO_INSTALL: '0' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('the monorepo pins @fixture/lib 2.0.0');
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'web'))).toBe(false);
  });
});
