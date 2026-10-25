import { afterAll, describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { IRecordedPreset, TAppSide } from '../../create/common/index.ts';
import { diffLines } from '../../create/diff.ts';
import { comparePresetFiles, detectPreset } from '../../create/preset-diff.ts';
import { copyWithFields } from '../preset.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND_PATH = join(FIXTURES, 'preset-backend');
const FRONTEND = `file:${join(FIXTURES, 'preset-frontend')}`;
const ENV = { VULCAN_NO_INSTALL: '1' };

/** A monorepo made from its own copy of the backend preset, so the test can improve the preset afterwards. */
const monorepo = (): { root: string; preset: string; files: string } => {
  const copy = copyWithFields({ fixture: BACKEND_PATH, fields: {} });
  const parent = createProject({ files: {} });

  runCli({
    args: [
      'init',
      '--preset',
      `file:${copy}`,
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

  return { root: join(parent, 'p'), preset: copy, files: join(copy, 'vulcan-preset', 'files') };
};

const diff = (opts: { root: string; args?: string[] }) =>
  runCli({ args: ['preset', 'diff', 'core-api', ...(opts.args ?? [])], cwd: opts.root, env: ENV });

/** Every file under a folder with its content: what "read-only" is checked against. */
const snapshot = (opts: { root: string }): Record<string, string> =>
  Object.fromEntries(
    readdirSync(opts.root, { recursive: true, encoding: 'utf8' })
      .filter((path) => !path.startsWith('.agents/local') && !path.startsWith('.git/'))
      .map((path) => {
        try {
          return [path, readFileSync(join(opts.root, path), 'utf8')];
        } catch {
          return [path, ''];
        }
      }),
  );

describe('vulcan preset diff', () => {
  test('an app just made from its preset has every file the same, and exits 0 even with --check', () => {
    const { root } = monorepo();
    const result = diff({ root, args: ['--check'] });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('against @fixture/backend@1.2.3');
    expect(result.stdout).toContain('services/core-api against');
    expect(result.stdout).toMatch(/\d+ files: \d+ same, 0 differ, 0 missing in the app/);
    expect(result.stdout).not.toContain('differs');
  });

  test('a changed preset file differs, a new one is missing, an edit of the app differs; exit 0 unless --check', () => {
    const { root, files } = monorepo();

    writeFileSync(
      join(files, 'src/index.ts'),
      "console.log('{{app}} of {{project}} on {{devPort}}');\nexport {};\n",
    );
    writeFileSync(join(files, 'gzip.conf'), 'gzip on;\n');
    writeFileSync(join(root, 'services/core-api/.configs/builders/Dockerfile'), 'mine\n');

    const result = diff({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('differs  src/index.ts  (+1 -0)');
    expect(result.stdout).toContain('differs  .configs/builders/Dockerfile  (+');
    expect(result.stdout).toContain('missing  gzip.conf');
    expect(result.stdout).toContain('2 differ, 1 missing in the app');
    expect(result.stdout).toContain('1 missing in the app');

    const checked = diff({ root, args: ['--check'] });

    expect(checked.code).toBe(1);
    expect(checked.stdout).toBe(result.stdout);
  });

  test('--full adds the unified diff under each file that differs, the app as - and the preset as +', () => {
    const { root, files } = monorepo();

    writeFileSync(
      join(files, 'src/index.ts'),
      "console.log('{{app}} of {{project}} on {{devPort}}');\nexport {};\n",
    );

    const summary = diff({ root }).stdout;
    const full = diff({ root, args: ['--full'] }).stdout;

    expect(summary).not.toContain('@@');
    expect(full).toContain('--- services/core-api/src/index.ts (the app)');
    expect(full).toContain('+++ src/index.ts (the preset)');
    expect(full).toContain('@@ -1,1 +1,2 @@');
    expect(full).toContain('+export {};');
    expect(full).toContain('differs  src/index.ts  (+1 -0)');
  });

  test('tokens come from the app: its name, project and the port its .env.example holds', () => {
    const { root, files } = monorepo();
    const app = join(root, 'services/core-api');

    writeFileSync(
      join(files, 'src/index.ts'),
      "console.log('{{app}} of {{project}} on {{devPort}}');\n",
    );
    writeFileSync(join(files, '_env.example'), 'PORT={{devPort}}\n');
    writeFileSync(join(app, 'src/index.ts'), "console.log('core-api of p on 4321');\n");
    writeFileSync(join(app, '.env.example'), 'PORT=4321\n');

    const same = diff({ root }).stdout;

    expect(same).toContain('same     src/index.ts');
    expect(same).toContain('same     .env.example');

    writeFileSync(join(app, 'src/index.ts'), "console.log('core-api of other on 4321');\n");
    expect(diff({ root }).stdout).toContain('differs  src/index.ts  (+1 -1)');
  });

  test('a binary file is compared by bytes and says so', () => {
    const { root, files } = monorepo();

    writeFileSync(join(files, 'logo.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(root, 'services/core-api/logo.bin'), Buffer.from([0, 1, 2, 9]));

    expect(diff({ root }).stdout).toContain('differs  logo.bin  (binary)');
  });

  test('nothing is written: the project is the same before and after, whatever the report says', () => {
    const { root, files } = monorepo();

    writeFileSync(join(files, 'gzip.conf'), 'gzip on;\n');

    const before = snapshot({ root });

    diff({ root, args: ['--full', '--check'] });
    expect(snapshot({ root })).toEqual(before);
  });

  test('the preset is found from the app: a dependency on its package and the recorded presets', () => {
    const { root } = monorepo();
    const manifest = join(root, 'services/core-api/package.json');
    const json = JSON.parse(readFileSync(manifest, 'utf8'));

    delete json.dependencies['@fixture/backend'];
    writeFileSync(manifest, `${JSON.stringify(json, null, 2)}\n`);

    const lost = diff({ root });

    expect(lost.code).toBe(1);
    expect(lost.stderr).toContain(
      "no recorded preset of the app's side is a dependency of the app",
    );
    expect(lost.stderr).toContain('--preset');

    // --preset names it by hand.
    const named = diff({ root, args: ['--preset', `file:${join(FIXTURES, 'preset-backend')}`] });

    expect(named.code, named.stderr).toBe(0);
    expect(named.stdout).toContain('@fixture/backend@1.2.3');
  });

  test('refuses an unknown app, a missing app, a preset that is not a preset, outside a monorepo', () => {
    const { root } = monorepo();
    const unknown = runCli({ args: ['preset', 'diff', 'nope'], cwd: root, env: ENV });
    const missing = runCli({ args: ['preset', 'diff'], cwd: root, env: ENV });
    const wrong = runCli({ args: ['preset', 'list'], cwd: root, env: ENV });
    const bare = runCli({
      args: ['preset', 'diff', 'x'],
      cwd: createProject({ files: {} }),
      env: ENV,
    });
    const notPreset = diff({ root, args: ['--preset', `file:${createProject({ files: {} })}`] });

    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("no app 'nope'");
    expect(unknown.stderr).toContain('core-api');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('usage: vulcan preset diff <app>');
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain('usage: vulcan preset diff <app>');
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain('run it at the root of a monorepo');
    expect(notPreset.code).toBe(1);
    expect(notPreset.stderr).toContain('no package at');
  });

  test('a frontend whose files use the proxy target needs --api or --no-api, as add did', () => {
    const { root } = monorepo();
    const add = runCli({
      args: [
        'add',
        '--preset',
        FRONTEND,
        '--frontend-dir',
        'apps',
        '--app',
        'web',
        '--api',
        'core-api',
      ],
      cwd: root,
      env: ENV,
    });

    expect(add.code, add.stderr).toBe(0);

    const bare = runCli({ args: ['preset', 'diff', 'web'], cwd: root, env: ENV });
    const same = runCli({
      args: ['preset', 'diff', 'web', '--api', 'core-api', '--check'],
      cwd: root,
      env: ENV,
    });
    const other = runCli({ args: ['preset', 'diff', 'web', '--no-api'], cwd: root, env: ENV });

    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain('missing --api <app> or --no-api');
    expect(same.code, same.stderr).toBe(0);
    expect(same.stdout).toContain('0 differ, 0 missing');
    expect(other.code).toBe(0);
    expect(other.stdout).toContain('differs  vite.config.ts');
  });

  /** The config records the preset by an npm spec, as init --preset ignis does, instead of the file: folder. */
  const recordNpmSpec = (opts: { root: string; spec: string }): void => {
    const config = join(opts.root, '.configs/vulcan.config.mts');

    writeFileSync(
      config,
      readFileSync(config, 'utf8').replace(/"spec": "file:[^"]*"/, `"spec": "${opts.spec}"`),
    );
  };

  /** The preset package installed where bun's isolated linker puts it: the folder of the one app that depends on it. */
  const installInApp = (opts: { root: string; preset: string }): string => {
    const target = join(opts.root, 'services/core-api/node_modules/@fixture/backend');

    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(opts.preset, target, { recursive: true });

    return target;
  };

  test('an npm preset is read from the app node_modules, where the isolated linker puts it, else from the root', () => {
    const { root, preset } = monorepo();

    recordNpmSpec({ root, spec: '@fixture/backend@^1.2.0' });

    const notInstalled = diff({ root });

    expect(notInstalled.code).toBe(1);
    expect(notInstalled.stderr).toContain('run bun install');

    const target = installInApp({ root, preset });
    const inApp = diff({ root, args: ['--check'] });

    expect(inApp.code, inApp.stderr).toBe(0);
    expect(inApp.stdout).toContain('(installed in node_modules)');
    expect(inApp.stdout).toContain('@fixture/backend@1.2.3');

    rmSync(target, { recursive: true });
    mkdirSync(join(root, 'node_modules/@fixture'), { recursive: true });
    cpSync(preset, join(root, 'node_modules/@fixture/backend'), { recursive: true });
    expect(diff({ root }).code).toBe(0);
  });

  test('a bare --preset name reads the installed copy; name@range is the one that fetches', () => {
    const { root, preset } = monorepo();

    installInApp({ root, preset });

    const bare = diff({ root, args: ['--preset', '@fixture/backend'] });
    const fetched = diff({ root, args: ['--preset', '@fixture/backend@^1.2.0'] });

    expect(bare.code, bare.stderr).toBe(0);
    expect(bare.stdout).toContain('(installed in node_modules)');
    // Tests never reach the network: the fetch is refused, and the scratch folder it made is gone.
    expect(fetched.code).toBe(1);
    expect(fetched.stderr).toContain('an npm preset needs an install');
    const scratch = join(root, '.agents/local/tmp');

    expect(existsSync(scratch) ? readdirSync(scratch) : []).toEqual([]);
  });

  test('two records of one package under two specs are one preset, not an ambiguity', () => {
    const { root, preset } = monorepo();

    recordNpmSpec({ root, spec: '@fixture/backend@^1.2.0' });
    installInApp({ root, preset });

    const config = join(root, '.configs/vulcan.config.mts');
    const source = readFileSync(config, 'utf8');
    const record = /\{\s*"spec": "@fixture\/backend@\^1\.2\.0"[^}]*\}/.exec(source)?.[0] ?? '';

    expect(record).not.toBe('');
    writeFileSync(
      config,
      source.replace(record, `${record}, ${record.replace('@^1.2.0', '@1.2.3')}`),
    );
    expect(diff({ root }).code).toBe(0);
  });

  test('a folder where the preset has a file is a difference, not a crash', () => {
    const { root, files } = monorepo();

    writeFileSync(join(files, 'gzip.conf'), 'gzip on;\n');
    mkdirSync(join(root, 'services/core-api/gzip.conf'), { recursive: true });

    const result = diff({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('differs  gzip.conf  (the app has a folder here)');
  });

  test('a flag that takes a value must have one, and only once', () => {
    const { root } = monorepo();
    const missing = diff({ root, args: ['--preset'] });
    const flagAsValue = diff({ root, args: ['--preset', '--full'] });
    const twice = diff({ root, args: ['--preset', 'file:x', '--preset', 'file:y'] });

    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('--preset needs a value');
    expect(flagAsValue.code).toBe(1);
    expect(flagAsValue.stderr).toContain('--preset needs a value');
    expect(twice.code).toBe(1);
    expect(twice.stderr).toContain('--preset is given more than once');
  });

  test('an unknown flag is refused like every command', () => {
    const { root } = monorepo();
    const result = runCli({ args: ['preset', 'diff', 'core-api', '--apply'], cwd: root, env: ENV });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown argument '--apply'");
  });
});

describe('detectPreset', () => {
  const recorded = (opts: { spec: string; side: TAppSide }): IRecordedPreset => ({
    ...opts,
    summary: 's',
  });

  test('two recorded presets of one side that the app both depends on need --preset', () => {
    const root = createProject({ files: {} });

    for (const name of ['a', 'b']) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, 'package.json'), JSON.stringify({ name: `@x/${name}` }));
    }

    const result = detectPreset({
      root,
      recorded: [
        recorded({ spec: 'file:a', side: 'backend' }),
        recorded({ spec: 'file:b', side: 'backend' }),
      ],
      dependencies: ['@x/a', '@x/b'],
      side: 'backend',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('more than one recorded preset fits the app');
  });

  test('the side must match: a frontend is not a backend preset', () => {
    const root = createProject({ files: {} });

    expect(
      detectPreset({
        root,
        recorded: [recorded({ spec: '@x/api', side: 'backend' })],
        dependencies: ['@x/api'],
        side: 'frontend',
      }).ok,
    ).toBe(false);
    expect(
      detectPreset({
        root,
        recorded: [recorded({ spec: '@x/api@1.0.0', side: 'backend' })],
        dependencies: ['@x/api'],
        side: 'backend',
      }),
    ).toEqual({ ok: true, spec: '@x/api@1.0.0' });
  });
});

describe('comparePresetFiles', () => {
  test('same, differs and missing, in path order, reading only', () => {
    const app = createProject({ files: { 'a.txt': 'one\n', 'c.txt': 'old\n' } });
    const reports = comparePresetFiles({
      appDirectory: app,
      rendered: [
        { path: 'c.txt', content: Buffer.from('new\n'), mode: 0o644 },
        { path: 'b.txt', content: Buffer.from('x\n'), mode: 0o644 },
        { path: 'a.txt', content: Buffer.from('one\n'), mode: 0o644 },
      ],
    });

    expect(reports.map((report) => [report.path, report.status])).toEqual([
      ['a.txt', 'same'],
      ['b.txt', 'missing'],
      ['c.txt', 'differs'],
    ]);
  });
});

describe('diffLines', () => {
  const lines = (...text: string[]): string => `${text.join('\n')}\n`;

  test('identical text has no change; one added and one removed line are counted', () => {
    expect(diffLines({ current: lines('a', 'b'), preset: lines('a', 'b') })).toEqual({
      added: 0,
      removed: 0,
      hunks: [],
    });
    expect(
      diffLines({ current: lines('a', 'b', 'c'), preset: lines('a', 'x', 'c') }),
    ).toMatchObject({
      added: 1,
      removed: 1,
    });
  });

  test('a hunk has the header, three lines of context, and - for the app and + for the preset', () => {
    const current = lines('1', '2', '3', '4', '5', '6', '7', '8', '9', '10');
    const preset = lines('1', '2', '3', '4', '5', 'five and a half', '6', '7', '8', '9', '10');
    const result = diffLines({ current, preset });

    expect(result.hunks).toEqual(['@@ -3,6 +3,7 @@\n 3\n 4\n 5\n+five and a half\n 6\n 7\n 8']);
  });

  test('changes far apart make two hunks, close ones merge into one', () => {
    const base = Array.from({ length: 30 }, (_, index) => `line ${index}`);
    const far = base.map((line, index) => (index === 2 || index === 25 ? `${line}!` : line));
    const near = base.map((line, index) => (index === 10 || index === 13 ? `${line}!` : line));

    expect(diffLines({ current: lines(...base), preset: lines(...far) }).hunks).toHaveLength(2);
    expect(diffLines({ current: lines(...base), preset: lines(...near) }).hunks).toHaveLength(1);
  });

  test('an empty side starts one line earlier, as GNU diff writes it', () => {
    expect(diffLines({ current: '', preset: lines('a', 'b') }).hunks).toEqual([
      '@@ -0,0 +1,2 @@\n+a\n+b',
    ]);
    expect(diffLines({ current: lines('a'), preset: '' }).hunks).toEqual(['@@ -1,1 +0,0 @@\n-a']);
  });

  test('only the last newline or the line endings differing is no hunk and 0 and 0', () => {
    expect(diffLines({ current: 'a\nb', preset: 'a\nb\n' })).toEqual({
      added: 0,
      removed: 0,
      hunks: [],
    });
    expect(diffLines({ current: 'a\r\nb\r\n', preset: 'a\nb\n' })).toEqual({
      added: 0,
      removed: 0,
      hunks: [],
    });
  });

  test('a file too large for the table is not diffed', () => {
    const big = lines(...Array.from({ length: 2100 }, (_, index) => `a${index}`));
    const other = lines(...Array.from({ length: 2100 }, (_, index) => `b${index}`));

    expect(diffLines({ current: big, preset: other }).hunks).toBeUndefined();
  });
});
