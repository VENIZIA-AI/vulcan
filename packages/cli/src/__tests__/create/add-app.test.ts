import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolvePackages } from '../../config/index.ts';
import { DoctorChecks, runDoctorChecks } from '../../doctor/index.ts';
import { copyWithUrls } from '../preset.helper.ts';
import { createProject, packFolder, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND_PATH = join(FIXTURES, 'preset-backend');
const FRONTEND_PATH = join(FIXTURES, 'preset-frontend');
const BACKEND = `file:${BACKEND_PATH}`;
const FRONTEND = `file:${FRONTEND_PATH}`;
const ENV = { VULCAN_NO_INSTALL: '1' };

const monorepo = (opts: { backend?: string } = {}): string => {
  const parent = createProject({ files: {} });

  runCli({
    args: [
      'init',
      '--preset',
      opts.backend ?? BACKEND,
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

interface IRootJson {
  name?: string;
  workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
  catalog?: Record<string, string>;
}

const readManifest = (opts: { root: string }): IRootJson =>
  JSON.parse(readFileSync(join(opts.root, 'package.json'), 'utf8'));

/** The catalog wherever the manifest keeps it. */
const catalogOf = (opts: { manifest: IRootJson }): Record<string, string> => {
  const { workspaces } = opts.manifest;

  return opts.manifest.catalog ?? (Array.isArray(workspaces) ? {} : (workspaces?.catalog ?? {}));
};

const writeManifest = (opts: { root: string; manifest: IRootJson }): void =>
  writeFileSync(join(opts.root, 'package.json'), `${JSON.stringify(opts.manifest, null, 2)}\n`);

/** Everything outside the vulcan:apps markers: what add must leave byte for byte. */
const outsideBlock = (opts: { source: string }): string => {
  const start = opts.source.indexOf('// vulcan:apps:start');
  const end = opts.source.indexOf('// vulcan:apps:end');

  return opts.source.slice(0, start) + opts.source.slice(end + '// vulcan:apps:end'.length);
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

  test('a block that is no longer JSON is refused and the config is left as it was', () => {
    const root = monorepo();
    const configPath = join(root, '.configs/vulcan.config.mts');
    const edited = readFileSync(configPath, 'utf8').replace('"layout"', 'layout');

    writeFileSync(configPath, edited);
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'worker'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is not the JSON vulcan wrote - add by hand:');
    expect(readFileSync(configPath, 'utf8')).toBe(edited);
    expect(existsSync(join(root, 'services/worker'))).toBe(false);
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

  test('add ends with the Next block: make dev and every app at its port', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'Done. web/admin is added. Next:\n  make dev\n  open http://localhost:3000\n  open http://localhost:5173\n',
    );
  });

  test('the Next block lists the urls of every app, the ones init recorded included', () => {
    const backend = copyWithUrls({ fixture: BACKEND_PATH, urls: ['/api/hello'] });
    const frontend = copyWithUrls({ fixture: FRONTEND_PATH, urls: ['/dashboard', '/login'] });
    const root = monorepo({ backend: `file:${backend}` });
    const result = runCli({
      args: [
        'add',
        '--preset',
        `file:${frontend}`,
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

    expect(result.stderr).toContain(
      'Next:\n  make dev\n  open http://localhost:3000/api/hello\n  open http://localhost:5173/dashboard\n  open http://localhost:5173/login\n',
    );
  });

  test('a new app on a taken port prints the port it was given', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'second-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.stderr).toContain('open http://localhost:3000\n  open http://localhost:3001\n');
  });

  test('an npm preset with --app missing is refused before the install is tried', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', '@fixture/none', '--frontend-dir', 'web', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --app');
    expect(result.stderr).not.toContain('needs an install');
  });

  test('an npm preset for a frontend without --api or --no-api is refused before the install', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', '@fixture/none', '--frontend-dir', 'web', '--app', 'admin'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --api <app> or --no-api');
    expect(result.stderr).not.toContain('needs an install');
  });

  test('an npm preset whose side has no folder yet is refused before the install, naming the flag', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', '@fixture/none', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --frontend-dir');
    expect(result.stderr).not.toContain('needs an install');
  });

  test('an npm preset that names nothing about its side is not refused early', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', '@fixture/none', '--app', 'second-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.stderr).toContain('needs an install');
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
        `@fixture/frontend@file:${packFolder({ folder: FRONTEND_PATH })}`,
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
  test('packages, sources and layout the user added outside the markers are not copied into the block', async () => {
    const root = monorepo();
    const configPath = join(root, '.configs/vulcan.config.mts');
    const edited = readFileSync(configPath, 'utf8')
      .replace('layout: apps.layout,', "layout: { ...apps.layout, shared: 'libs' },")
      .replace(
        'packages: apps.packages,',
        "packages: [...apps.packages, { dir: 'worker', name: 'worker', path: 'services/worker' }],",
      )
      .replace(
        'atlas: { sources: apps.sources },',
        "atlas: { sources: [...apps.sources, { name: 'extra', repo: 'example/extra', ref: 'main' }] },",
      );
    const manifest = readManifest({ root });

    writeFileSync(configPath, edited);
    writeManifest({
      root,
      manifest: {
        ...manifest,
        workspaces: {
          ...(Array.isArray(manifest.workspaces) ? {} : manifest.workspaces),
          packages: ['services/*', 'libs/*'],
        },
      },
    });

    const result = runCli({
      args: ['add', '--preset', BACKEND, '--app', 'billing'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);

    const after = readFileSync(configPath, 'utf8');

    expect(outsideBlock({ source: after })).toBe(outsideBlock({ source: edited }));

    const loaded = await loadConfig({ root });

    if (!loaded.ok) {
      throw new Error(loaded.error);
    }

    const dirs = resolvePackages({ config: loaded.config }).map(entry => entry.dir);
    const sourceNames = loaded.config.atlas.sources.map(source => source.name);

    expect(dirs.toSorted()).toEqual(['billing', 'core-api', 'worker']);
    expect(sourceNames.toSorted()).toEqual(['extra', 'fixture']);
    expect(loaded.config.layout).toEqual({ backend: 'services', shared: 'libs' });

    const apps = (await runDoctorChecks({ root })).filter(
      violation => violation.check === DoctorChecks.APPS,
    );

    expect(apps).toEqual([]);
  });

  test('array-form workspaces keep every glob and stay an array', () => {
    const root = monorepo();
    const manifest = readManifest({ root });
    const catalog = catalogOf({ manifest });

    writeManifest({
      root,
      manifest: {
        name: manifest.name,
        workspaces: ['services/*', 'libs/*', 'tools/*'],
        catalog,
      },
    });

    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);

    const after = readManifest({ root });

    expect(after.workspaces).toEqual(['services/*', 'libs/*', 'tools/*', 'web/*']);
    expect(after.catalog?.['@fixture/frontend']).toBe(FRONTEND);
    expect(after.workspaces).not.toHaveProperty('catalog');
  });

  test('a top-level catalog next to object-form workspaces stays where it is', () => {
    const root = monorepo();
    const manifest = readManifest({ root });
    const catalog = catalogOf({ manifest });

    writeManifest({
      root,
      manifest: { name: manifest.name, workspaces: { packages: ['services/*'] }, catalog },
    });

    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);

    const after = readManifest({ root });

    expect(after.workspaces).toEqual({ packages: ['services/*', 'web/*'] });
    expect(after.catalog?.['@fixture/frontend']).toBe(FRONTEND);
  });

  test('the peer check reads a top-level catalog too', () => {
    const root = monorepo();
    const manifest = readManifest({ root });

    writeManifest({
      root,
      manifest: {
        name: manifest.name,
        workspaces: ['services/*'],
        catalog: { '@fixture/lib': '2.0.0' },
      },
    });

    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('the monorepo pins @fixture/lib 2.0.0');
  });

  test('the knowledge index keeps everything but one new bullet per added app', () => {
    const root = monorepo();
    const indexPath = join(root, '.agents/knowledge/index.md');
    const written = readFileSync(indexPath, 'utf8');
    const handWritten = `${written.trimEnd()}\n\n## Notes\n\nA paragraph a person wrote.\n`;

    writeFileSync(indexPath, `${handWritten.replace('## Apps', 'Intro by hand.\n\n## Apps')}`);

    for (const app of ['worker', 'billing']) {
      expect(
        runCli({ args: ['add', '--preset', BACKEND, '--app', app], cwd: root, env: ENV }).code,
      ).toBe(0);
    }

    const index = readFileSync(indexPath, 'utf8');

    expect(index).toContain('Intro by hand.');
    expect(index).toContain('## Notes\n\nA paragraph a person wrote.\n');
    expect(index.match(/\[worker\]\(packages\/worker\.md\)/g)).toHaveLength(1);
    expect(index.match(/\[billing\]\(packages\/billing\.md\)/g)).toHaveLength(1);
    expect(index.indexOf('[core-api]')).toBeLessThan(index.indexOf('[worker]'));
    expect(index.indexOf('[worker]')).toBeLessThan(index.indexOf('[billing]'));
    expect(index.indexOf('[billing]')).toBeLessThan(index.indexOf('## Notes'));
  });

  test('a knowledge index without an Apps section gets one', () => {
    const root = monorepo();
    const indexPath = join(root, '.agents/knowledge/index.md');

    writeFileSync(indexPath, '# p\n\nAll by hand.\n');
    runCli({ args: ['add', '--preset', BACKEND, '--app', 'worker'], cwd: root, env: ENV });

    expect(readFileSync(indexPath, 'utf8')).toBe(
      '# p\n\nAll by hand.\n\n## Apps\n\n- [worker](packages/worker.md) - A fixture backend.\n',
    );
  });

  test('a folder that is another side folder in the config is refused naming both', () => {
    const root = monorepo();
    const result = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'services',
        '--app',
        'admin',
        '--no-api',
      ],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("frontend folder 'services' is the backend folder");
    expect(existsSync(join(root, 'services/admin'))).toBe(false);
  });

  test('a file: preset warns that the catalog entry is not portable', () => {
    const root = monorepo();
    const result = runCli({
      args: ['add', '--preset', FRONTEND, '--frontend-dir', 'web', '--app', 'admin', '--no-api'],
      cwd: root,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(`file:${FRONTEND_PATH}`);
    expect(result.stderr).toContain('not portable');
  });
});
