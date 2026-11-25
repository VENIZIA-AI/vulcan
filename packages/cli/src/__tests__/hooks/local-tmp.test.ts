import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { PresetScratch } from '../../create/scratch.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { HookConstants, ProjectTmp } from '../../hooks/index.ts';
import { CleanScopes, LocalScan } from '../../local/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { isolateOwnerReplySwitch } from '../owner-reply-env.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { GUARD_MANIFEST_FILE } from '../guard-manifest.helper.ts';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';

afterAll(removeProjects);
isolateOwnerReplySwitch();

const MANIFEST = '.agents/local/vulcan.manifest.json';
const manifestWith = (tmp: unknown): string => JSON.stringify({ schemaVersion: 1, local: { tmp } });
const projectWith = (tmp: unknown): string =>
  createProject({ files: { [MANIFEST]: manifestWith(tmp), '.agents/rules.md': '' } });
const CONFIG = "export default { project: { name: 'acme' }, common: { local: { tmp: 't' } } };\n";

describe('local.tmp in the config', () => {
  const parse = (tmp: unknown): { success: boolean; message: string } => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ local: { tmp } });

    return { success: result.success, message: result.success ? '' : result.error.message };
  };

  test.each(['t', 'scratch', 'tools/t'])('%s is a folder of the project', (tmp) => {
    expect(parse(tmp).success).toBe(true);
  });

  test.each(['../t', '/tmp/t', 't/', '', 'a/../b', 'node_modules/t', '.t'])(
    '%s is refused, like a layout folder',
    (tmp) => {
      expect(parse(tmp).success).toBe(false);
    },
  );

  test('the key is optional, and the default is the folder of the layout', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).local.tmp).toBeUndefined();
    expect(HookConstants.PROJECT_TMP).toBe('.agents/tmp');
  });
});

describe('local.tmp in the manifest', () => {
  const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
  const render = (config: object): Record<string, unknown> =>
    JSON.parse(ProjectManifest.render({ root, config: VULCAN_CONFIG_SCHEMA.parse(config) }));

  test('carries the folder, next to autoClean', () => {
    expect(render({ local: { tmp: 't' } }).local).toEqual({ tmp: 't' });
    expect(render({ local: { tmp: 't', autoClean: false } }).local).toEqual({
      autoClean: false,
      tmp: 't',
    });
  });

  test('carries nothing when the project sets neither', () => {
    expect(render({}).local).toBeUndefined();
  });
});

describe('ProjectTmp.projectOf, the one method', () => {
  test('without the key it is .agents/tmp', () => {
    const root = createProject({ files: { [MANIFEST]: '{"schemaVersion":1}' } });

    expect(ProjectTmp.projectOf({ root })).toBe(join(root, '.agents/tmp'));
    expect(ProjectTmp.projectOf({ root: '/work/acme' })).toBe('/work/acme/.agents/tmp');
  });

  test('with the key in the manifest it is that folder of the project', () => {
    const root = projectWith('t');

    expect(ProjectTmp.projectOf({ root })).toBe(join(root, 't'));
  });

  test('a value that is not a layout folder is not followed', () => {
    for (const tmp of ['../outside', '/tmp/x', 42, '']) {
      const root = projectWith(tmp);

      expect(ProjectTmp.projectOf({ root })).toBe(join(root, '.agents/tmp'));
    }
  });

  test('a caller that has just read the config passes the key and it wins over the manifest', () => {
    const root = projectWith('old');

    expect(ProjectTmp.projectOf({ root, tmp: 'new' })).toBe(join(root, 'new'));
  });
});

describe('the five readers follow the key', () => {
  test('the session-start export sets TMPDIR to it and makes it', () => {
    const root = projectWith('t');
    const envFile = join(root, 'env.sh');

    expect(ProjectTmp.exportProjectTmp({ root, envFile })).toBe(true);
    expect(readFileSync(envFile, 'utf8')).toBe(`export TMPDIR='${join(root, 't')}'\n`);
    expect(existsSync(join(root, 't'))).toBe(true);
  });

  test('the rules block of AGENTS.md names it, relative to the project', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': CONFIG,
        'AGENTS.md': '# AGENTS.md\n\n## Must read first\n\n| a | b |\n',
      },
    });

    runCli({ args: ['project', 'sync', '--agents', 'none'], cwd: root });

    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');

    expect(text).toContain('go in `t`, never /tmp');
    expect(text).toContain('export TMPDIR="$PWD/t"');
    expect(text).not.toContain(root);
  });

  test('vulcan project clean takes the old files of it, not of the default folder', () => {
    const root = projectWith('t');
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    for (const folder of ['t/old', '.agents/tmp/ignored']) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, 'a.txt'), 'x');
      utimesSync(join(root, folder, 'a.txt'), old, old);
      utimesSync(join(root, folder), old, old);
    }

    const found = LocalScan.scan({ root, only: [CleanScopes.TMP] }).map((entry) => entry.path);

    expect(found).toContain(join(root, 't/old'));
    expect(found).not.toContain(join(root, '.agents/tmp/ignored'));
  });

  test('the scratch of vulcan package add is made in it', async () => {
    const root = projectWith('t');
    const seen = await PresetScratch.withScratch({ root, run: async (scratch) => scratch });

    expect(seen.startsWith(join(root, 't'))).toBe(true);
  });
});

describe('vulcan project sync with local.tmp', () => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      'package.json': '{ "name": "@x/acme-workspace" }',
      '.gitignore': 'node_modules\n',
    },
  });

  test('makes the folder, ignores it, writes no launch file, and the next run changes nothing', () => {
    const first = runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });

    expect(first.code, first.stderr).toBe(0);
    expect(existsSync(join(root, 't'))).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('/t/');
    expect(existsSync(join(root, '.agents/local/claude.launch.settings.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).local).toEqual({ tmp: 't' });

    const second = runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });

    expect(second.stdout + second.stderr).not.toMatch(/\n\s+(created|replaced)\s+.*\bt\b/);
  });
});

describe('vulcan project doctor: local.tmp that cannot hold a browser socket', () => {
  const contextOf = (opts: { root: string; tmp: string }) => ({
    root: opts.root,
    config: VULCAN_CONFIG_SCHEMA.parse({ local: { tmp: opts.tmp } }),
    configFile: '.configs/vulcan.config.mts',
  });

  test('a deep checkout fails with the length, even with a short folder', () => {
    const found = ProjectContract.checkTmpFolder(
      contextOf({ root: `/${'a'.repeat(80)}`, tmp: 't' }),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe('.configs/vulcan.config.mts');
    expect(found[0]?.message).toContain("local.tmp 't': its socket path for a browser would be");
    expect(found[0]?.message).toContain('the limit is 107');
  });

  test('a short checkout passes, and so does a project without the key', () => {
    expect(ProjectContract.checkTmpFolder(contextOf({ root: '/work/acme', tmp: 't' }))).toEqual([]);
    expect(
      ProjectContract.checkTmpFolder({
        root: `/${'a'.repeat(80)}`,
        config: VULCAN_CONFIG_SCHEMA.parse({}),
        configFile: 'c',
      }),
    ).toEqual([]);
  });
});

describe('the review of local.tmp', () => {
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  test('vulcan project clean removes the old files of the folder, and not those of a folder it does not own', () => {
    const root = projectWith('t');

    for (const folder of ['t/old']) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, 'a.txt'), 'x');
      utimesSync(join(root, folder, 'a.txt'), old, old);
      utimesSync(join(root, folder), old, old);
    }

    mkdirSync(join(root, '.agents/local'), { recursive: true });

    const result = runCli({ args: ['project', 'clean', '--tmp', '--yes'], cwd: root });

    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(join(root, 't/old'))).toBe(false);
    expect(result.stdout + result.stderr).not.toContain('refused');
  });

  test('a link in place of the folder is not trusted by clean', () => {
    const root = projectWith('t');
    const elsewhere = createProject({ files: { 'keep/a.txt': 'x' } });

    symlinkSync(elsewhere, join(root, 't'));

    expect(LocalScan.tmpRootOf({ root })).toBeUndefined();
  });

  test('taking the key out of the config sends the next sync back to the default folder', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': CONFIG,
        'package.json': '{ "name": "@x/acme-workspace" }',
        '.gitignore': 'node_modules\n',
      },
    });

    runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });
    writeFileSync(
      join(root, '.configs/vulcan.config.mts'),
      "export default { project: { name: 'acme' } };\n",
    );

    const again = runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });

    expect(again.code, again.stderr).toBe(0);
    expect(existsSync(join(root, '.agents/tmp'))).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.agents/local/');
  });

  test('the guard-outside answer names the folder the project uses', async () => {
    const root = projectWith('t');
    const input = `{"tool_name":"Write","tool_input":{"file_path":"/srv/vulcan-fixture/x.txt","content":"x"},"cwd":${JSON.stringify(root)}}`;
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-outside.ts'),
      ],
      {
        cwd: root,
        stdin: new TextEncoder().encode(input),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    );
    const stdoutResponse = new Response(child.stdout);
    const stdout = await stdoutResponse.text();

    await child.exited;

    expect(stdout).toContain('Scratch files go under t/<task>/');
    expect(GUARD_MANIFEST_FILE).toBe(MANIFEST);
  });

  const contextOf = (opts: { tmp: string; layout?: Record<string, string> }) => ({
    root: '/work/acme',
    config: VULCAN_CONFIG_SCHEMA.parse({ local: { tmp: opts.tmp }, layout: opts.layout }),
    configFile: '.configs/vulcan.config.mts',
  });

  test('doctor fails a folder that is, or holds, a layout folder', () => {
    const found = ProjectContract.checkTmpFolder(
      contextOf({ tmp: 'apps', layout: { backend: 'apps/api' } }),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("holds, the layout folder 'apps/api'");
  });

  test('doctor fails a folder in which git tracks a file', () => {
    const root = createProject({ files: { 'tmp/kept.txt': 'x' } });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    Bun.spawnSync(['git', 'add', 'tmp/kept.txt'], { cwd: root });

    const found = ProjectContract.checkTmpFolder({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({ local: { tmp: 'tmp' } }),
      configFile: '.configs/vulcan.config.mts',
    });

    expect(found.some((entry) => entry.message.includes('git tracks files in it'))).toBe(true);
  });

  test('the browser warning is for a project without the key; with the key only checkTmpFolder speaks', () => {
    const root = createProject({ files: {} });
    const deep = join(root, 'd'.repeat(80));

    mkdirSync(join(deep, '.agents/local'), { recursive: true });

    expect(ProjectContract.checkBrowserSocket({ root: deep })).toHaveLength(1);
    expect(ProjectContract.checkBrowserSocket({ root: deep, tmp: 'tmp' })).toEqual([]);
  });
});
