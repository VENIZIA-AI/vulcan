import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PresetScratch } from '../../create/scratch.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { HookConstants, ProjectTmp, SessionDigest } from '../../hooks/index.ts';
import { CleanScopes, LocalScan } from '../../local/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { ClaudeLaunch, CLAUDE_LAUNCH_FILE } from '../../sync/claude-launch.ts';
import { isolateOwnerReplySwitch } from '../owner-reply-env.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);
isolateOwnerReplySwitch();

const MANIFEST = '.agents/vulcan.manifest.json';
const manifestWith = (tmp: unknown): string => JSON.stringify({ schemaVersion: 1, local: { tmp } });
const projectWith = (tmp: unknown): string =>
  createProject({ files: { [MANIFEST]: manifestWith(tmp), '.agents/rules.md': '' } });
const CONFIG = "export default { name: 'acme', local: { tmp: 't' } };\n";

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
    expect(HookConstants.PROJECT_TMP).toBe('.agents/local/tmp');
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
  test('without the key it is .agents/local/tmp', () => {
    const root = createProject({ files: { [MANIFEST]: '{"schemaVersion":1}' } });

    expect(ProjectTmp.projectOf({ root })).toBe(join(root, '.agents/local/tmp'));
    expect(ProjectTmp.projectOf({ root: '/work/acme' })).toBe('/work/acme/.agents/local/tmp');
  });

  test('with the key in the manifest it is that folder of the project', () => {
    const root = projectWith('t');

    expect(ProjectTmp.projectOf({ root })).toBe(join(root, 't'));
  });

  test('a value that is not a layout folder is not followed', () => {
    for (const tmp of ['../outside', '/tmp/x', 42, '']) {
      const root = projectWith(tmp);

      expect(ProjectTmp.projectOf({ root })).toBe(join(root, '.agents/local/tmp'));
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

  test('the session digest names it', async () => {
    const root = projectWith('t');
    const digest = await SessionDigest.build({ projectRoot: root });

    expect(digest).toContain(`Scratch and temporary files go in \`${join(root, 't')}\``);
    expect(digest).toContain(`export TMPDIR=${join(root, 't')}`);
  });

  test('a Claude Code session with CLAUDE_CODE_TMPDIR on it is inside the project', () => {
    const root = projectWith('t');

    expect(ClaudeLaunch.tmpOf({ root, env: { CLAUDE_CODE_TMPDIR: join(root, 't') } }).state).toBe(
      'inside',
    );
    expect(ClaudeLaunch.tmpOf({ root, env: { CLAUDE_CODE_TMPDIR: '/var/tmp/other' } }).state).toBe(
      'outside',
    );
  });

  test('vulcan clean takes the old files of it, not of the default folder', () => {
    const root = projectWith('t');
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    for (const folder of ['t/old', '.agents/local/tmp/ignored']) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, 'a.txt'), 'x');
      utimesSync(join(root, folder, 'a.txt'), old, old);
      utimesSync(join(root, folder), old, old);
    }

    const found = LocalScan.scan({ root, only: [CleanScopes.TMP] }).map((entry) => entry.path);

    expect(found).toContain(join(root, 't/old'));
    expect(found).not.toContain(join(root, '.agents/local/tmp/ignored'));
  });

  test('the scratch of vulcan add is made in it', async () => {
    const root = projectWith('t');
    const seen = await PresetScratch.withScratch({ root, run: async (scratch) => scratch });

    expect(seen.startsWith(join(root, 't'))).toBe(true);
  });
});

describe('vulcan sync with local.tmp', () => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      'package.json': '{ "name": "@x/acme-workspace" }',
      '.gitignore': 'node_modules\n',
    },
  });

  test('makes the folder, ignores it, points the launch file at it, and the next run changes nothing', () => {
    const first = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(first.code, first.stderr).toBe(0);
    expect(existsSync(join(root, 't'))).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('/t/');
    expect(JSON.parse(readFileSync(join(root, CLAUDE_LAUNCH_FILE), 'utf8')).env).toEqual({
      TMPDIR: join(root, 't'),
      CLAUDE_CODE_TMPDIR: join(root, 't'),
    });
    expect(JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).local).toEqual({ tmp: 't' });

    const second = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(second.stdout + second.stderr).not.toContain('names another folder');
    expect(second.stdout + second.stderr).not.toMatch(/\n\s+(created|replaced)\s+.*\bt\b/);
  });
});

describe('vulcan doctor: local.tmp that cannot hold a browser socket', () => {
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
    expect(found[0]?.message).toContain("local.tmp 't' is still too deep");
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
