import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeCommand } from '../fake-command.helper.ts';
import { copyWithFields, copyWithUrls } from '../preset.helper.ts';
import { createProject, packFolder, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const BACKEND = join(import.meta.dir, '..', 'fixtures', 'preset-backend');
const ENV = { VULCAN_NO_INSTALL: '1' };
const FLAGS = [
  '--preset',
  `file:${BACKEND}`,
  '--project',
  'my-product',
  '--backend-dir',
  'services',
  '--app',
  'core-api',
  '--shared-dir',
  'libs',
];

describe('vulcan init --preset', () => {
  test('creates the monorepo with its first app', () => {
    const parent = createProject({ files: {} });
    const result = runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });
    const root = join(parent, 'my-product');

    expect(result.code).toBe(0);

    for (const path of [
      'package.json',
      '.gitignore',
      'AGENTS.md',
      'Makefile',
      '.mcp.json',
      '.agents/rules.md',
      '.configs/vulcan.config.mts',
      '.agents/knowledge/index.md',
      '.agents/knowledge/log.md',
      '.agents/knowledge/packages/core-api.md',
      'services/core-api/package.json',
      'services/core-api/src/index.ts',
      'services/core-api/.env.example',
      'libs/.gitkeep',
    ]) {
      expect(existsSync(join(root, path))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

    expect(manifest.workspaces.packages).toEqual(['services/*', 'libs/*']);
    expect(manifest.workspaces.catalog['@fixture/lib']).toBe('1.0.0');
    expect(manifest.workspaces.catalog['@fixture/backend']).toBe(`file:${BACKEND}`);
    expect(readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8')).toContain(
      '"backend": "services"',
    );
    expect(readFileSync(join(root, 'services/core-api/src/index.ts'), 'utf8')).toContain(
      'core-api of my-product on 3000',
    );
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('CLAUDE.md');
    expect(readFileSync(join(root, '.agents/knowledge/index.md'), 'utf8')).not.toContain(
      'vulcan:scaffold',
    );
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toContain('\ndev:\n\t@bun run dev\n');
    expect(result.stderr).toContain('skipped  bun install');
    expect(result.stderr).toContain('skipped  vulcan sync');
    expect(result.stderr).toContain('skipped  git init');
    expect(result.stderr).toContain('skipped  bun run typecheck');
    expect(result.stderr).toContain('cd my-product && make dev');
  });

  test('the Done message ends with the first app URL, from the preset dev port', () => {
    const parent = createProject({ files: {} });
    const result = runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    expect(result.stderr).toContain(
      'Done. Next:\n  cd my-product && make dev\n  open http://localhost:3000\n',
    );
  });

  test('a preset with urls prints one open line per path on the dev port', () => {
    const parent = createProject({ files: {} });
    const preset = copyWithUrls({ fixture: BACKEND, urls: ['/api/hello', '/api/doc/explorer'] });
    const flags = FLAGS.map(flag => (flag === `file:${BACKEND}` ? `file:${preset}` : flag));
    const result = runCli({ args: ['init', ...flags], cwd: parent, env: ENV });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'Done. Next:\n  cd my-product && make dev\n  open http://localhost:3000/api/hello\n  open http://localhost:3000/api/doc/explorer\n',
    );
    expect(result.stderr).not.toContain('open http://localhost:3000\n');
  });

  test('the urls are recorded in the app manifest for add to print later', () => {
    const parent = createProject({ files: {} });
    const preset = copyWithUrls({ fixture: BACKEND, urls: ['/api/hello'] });
    const flags = FLAGS.map(flag => (flag === `file:${BACKEND}` ? `file:${preset}` : flag));

    runCli({ args: ['init', ...flags], cwd: parent, env: ENV });

    const manifest = JSON.parse(
      readFileSync(join(parent, 'my-product', 'services/core-api/package.json'), 'utf8'),
    );

    expect(manifest.vulcan).toEqual({ urls: ['/api/hello'] });
  });

  test('a preset without urls leaves no vulcan key in the app manifest', () => {
    const parent = createProject({ files: {} });

    runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    const manifest = JSON.parse(
      readFileSync(join(parent, 'my-product', 'services/core-api/package.json'), 'utf8'),
    );

    expect(manifest.vulcan).toBeUndefined();
  });

  test('the preset imports reach the app manifest, values verbatim', () => {
    const parent = createProject({ files: {} });
    const imports = { '#src/*.json': './src/*.json', '#src/*': './src/{{app}}/*.js' };
    const preset = copyWithFields({ fixture: BACKEND, fields: { imports } });
    const flags = FLAGS.map(flag => (flag === `file:${BACKEND}` ? `file:${preset}` : flag));

    runCli({ args: ['init', ...flags], cwd: parent, env: ENV });

    const manifest = JSON.parse(
      readFileSync(join(parent, 'my-product', 'services/core-api/package.json'), 'utf8'),
    );

    expect(manifest.imports).toEqual(imports);
  });

  test('a preset without imports leaves no imports key in the app manifest', () => {
    const parent = createProject({ files: {} });

    runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    const manifest = JSON.parse(
      readFileSync(join(parent, 'my-product', 'services/core-api/package.json'), 'utf8'),
    );

    expect('imports' in manifest).toBe(false);
  });

  test('a preset import key without # is refused and nothing is written', () => {
    const parent = createProject({ files: {} });
    const preset = copyWithFields({
      fixture: BACKEND,
      fields: { imports: { 'src/*': './src/*.js' } },
    });
    const flags = FLAGS.map(flag => (flag === `file:${BACKEND}` ? `file:${preset}` : flag));
    const result = runCli({ args: ['init', ...flags], cwd: parent, env: ENV });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('src/*');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test("the root dev entry runs every app's server:dev, and make dev calls it", () => {
    const parent = createProject({ files: {} });

    expect(runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV }).code).toBe(0);

    const root = join(parent, 'my-product');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const ran = Bun.spawnSync(['bun', 'run', 'dev'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

    expect(manifest.scripts.dev).toBe("bun run --filter '*' server:dev");
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toContain('\ndev:\n\t@bun run dev\n');
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout.toString()).toContain('fixture-backend-up');
  });

  test('an app that lacks server:dev is skipped by the root dev entry, not an error', () => {
    const parent = createProject({ files: {} });

    runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    const root = join(parent, 'my-product');

    mkdirSync(join(root, 'libs', 'shared'), { recursive: true });
    writeFileSync(
      join(root, 'libs', 'shared', 'package.json'),
      '{ "name": "shared", "private": true }',
    );

    const ran = Bun.spawnSync(['bun', 'run', 'dev'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

    expect(ran.exitCode).toBe(0);
    expect(ran.stdout.toString()).toContain('fixture-backend-up');
  });

  test('the root .gitignore ignores *.tsbuildinfo', () => {
    const parent = createProject({ files: {} });

    runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    const lines = readFileSync(join(parent, 'my-product', '.gitignore'), 'utf8').split('\n');

    expect(lines).toContain('*.tsbuildinfo');
  });

  test('a frontend first app gets its own dev port in the URL', () => {
    const parent = createProject({ files: {} });
    const frontend = join(import.meta.dir, '..', 'fixtures', 'preset-frontend');
    const result = runCli({
      args: [
        'init',
        '--preset',
        `file:${frontend}`,
        '--project',
        'p',
        '--frontend-dir',
        'web',
        '--app',
        'admin',
        '--no-api',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.stderr).toContain('open http://localhost:5173\n');
  });

  test('a missing git prints what to run and the rest of the flow still runs', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: ['init', ...FLAGS],
      cwd: parent,
      env: {
        VULCAN_BUN: createFakeCommand({ body: 'exit 0' }),
        VULCAN_GIT: join(parent, 'no-such-git'),
      },
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('install git, then run: git init -b develop');
    expect(result.stderr).toContain(join(parent, 'my-product'));
    expect(result.stderr).toContain('Done. Next:');
  });

  test('the shared folder is skipped when not named', () => {
    const parent = createProject({ files: {} });
    const flags = FLAGS.slice(0, -2);

    expect(runCli({ args: ['init', ...flags], cwd: parent, env: ENV }).code).toBe(0);
    expect(
      JSON.parse(readFileSync(join(parent, 'my-product/package.json'), 'utf8')).workspaces.packages,
    ).toEqual(['services/*']);
    expect(existsSync(join(parent, 'my-product/libs'))).toBe(false);
  });

  test('a non-empty target folder is refused before anything is written', () => {
    const parent = createProject({ files: { 'my-product/README.md': '# mine\n' } });
    const result = runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('my-product exists and is not empty');
    expect(existsSync(join(parent, 'my-product/package.json'))).toBe(false);
    expect(existsSync(join(parent, 'my-product/services'))).toBe(false);
    expect(readFileSync(join(parent, 'my-product/README.md'), 'utf8')).toBe('# mine\n');
  });

  test('without a TTY a missing name is an error and nothing is written', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: ['init', '--preset', `file:${BACKEND}`, '--project', 'my-product'],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --backend-dir');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('without a TTY a missing app name is an error naming --app and nothing is written', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: [
        'init',
        '--preset',
        `file:${BACKEND}`,
        '--project',
        'my-product',
        '--backend-dir',
        'services',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --app');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('without a TTY a missing project name is an error and nothing is written', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: ['init', '--preset', `file:${BACKEND}`],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --project');
  });

  test('a preset that is not there is an error and nothing is written', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: ['init', '--preset', `file:${join(parent, 'nowhere')}`, '--project', 'p', '--app', 'a'],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no package at');
    expect(existsSync(join(parent, 'p'))).toBe(false);
  });

  test('an npm preset cannot be located offline', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: ['init', '--preset', 'some-name', '--project', 'p', '--app', 'a'],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('an npm preset needs an install');
  });

  // The side flag is known only after the package is read, so the package is installed outside the
  // target first. bun adds a file: range offline, which stands in for the registry here.
  test('an npm preset with its side flag missing refuses and the target never exists', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: [
        'init',
        '--preset',
        `@fixture/backend@file:${packFolder({ folder: BACKEND })}`,
        '--project',
        'my-product',
        '--app',
        'core-api',
      ],
      cwd: parent,
      env: { VULCAN_NO_INSTALL: '0' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing --backend-dir');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('an npm package that ships no preset refuses and the target never exists', () => {
    const parent = createProject({
      files: { 'nopreset/package.json': '{ "name": "@fixture/none", "version": "1.0.0" }' },
    });
    const result = runCli({
      args: [
        'init',
        '--preset',
        `@fixture/none@file:${packFolder({ folder: join(parent, 'nopreset') })}`,
        '--project',
        'my-product',
        '--app',
        'core-api',
      ],
      cwd: parent,
      env: { VULCAN_NO_INSTALL: '0' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ships no VULCAN preset');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('a frontend preset makes the first app a frontend', () => {
    const parent = createProject({ files: {} });
    const frontend = join(import.meta.dir, '..', 'fixtures', 'preset-frontend');
    const result = runCli({
      args: [
        'init',
        '--preset',
        `file:${frontend}`,
        '--project',
        'p',
        '--frontend-dir',
        'web',
        '--app',
        'admin',
        '--no-api',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(parent, 'p/web/admin/vite.config.ts'))).toBe(true);
  });
  test('the same folder for two kinds of code is refused naming both flags and nothing is written', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: [
        'init',
        '--preset',
        `file:${BACKEND}`,
        '--project',
        'my-product',
        '--backend-dir',
        'code',
        '--app',
        'core-api',
        '--shared-dir',
        'code',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--backend-dir');
    expect(result.stderr).toContain('--shared-dir');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('a backend and a frontend folder that match are refused naming both flags', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: [
        'init',
        '--preset',
        `file:${BACKEND}`,
        '--project',
        'my-product',
        '--backend-dir',
        'code',
        '--frontend-dir',
        'code',
        '--app',
        'core-api',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--backend-dir');
    expect(result.stderr).toContain('--frontend-dir');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('a file: preset warns that the catalog entry is not portable', () => {
    const parent = createProject({ files: {} });
    const result = runCli({ args: ['init', ...FLAGS], cwd: parent, env: ENV });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(`file:${BACKEND}`);
    expect(result.stderr).toContain('not portable');
  });
});
