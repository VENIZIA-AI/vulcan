import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { ProjectLayout } from '../../common/constants.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const context = (root: string) => ({
  root,
  config: VULCAN_CONFIG_SCHEMA.parse({}),
  configFile: '.configs/vulcan.config.mts',
});
const runPrepare = (root: string) =>
  spawnSyncBounded({
    cmd: ['sh', '-c', ProjectLayout.PREPARE_SCRIPT],
    cwd: root,
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

describe('the prepare script cannot fail an install', () => {
  test('without the bin it prints a note and exits 0', () => {
    const run = runPrepare(createProject({ files: {} }));

    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain('not installed yet');
  });

  test('with a bin whose sync fails it prints a note and exits 0', () => {
    const root = createProject({
      files: { 'node_modules/.bin/vulcan': 'console.error("boom");\nprocess.exit(3);\n' },
    });
    const run = runPrepare(root);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain('sync did not finish');
  });

  test('with a working bin it runs `sync --quiet` with no terminal on its input', async () => {
    const root = createProject({
      files: {
        'node_modules/.bin/vulcan':
          "await Bun.write('ran.txt', `${process.argv.slice(2).join(' ')}|${process.stdin.isTTY === true ? 'tty' : 'no-tty'}`);\n",
      },
    });
    const run = runPrepare(root);

    expect(run.exitCode).toBe(0);
    const result = await Bun.file(join(root, 'ran.txt')).text();
    expect(result).toBe('project sync --quiet|no-tty');
  });

  test('the script text reads no terminal and always exits 0', () => {
    expect(ProjectLayout.PREPARE_SCRIPT).toContain('vulcan project sync --quiet < /dev/null');
    expect(ProjectLayout.PREPARE_SCRIPT.endsWith('exit 0')).toBe(true);
  });
});

/** The old spelling, built so that the gate over retired names does not read it as a use. */
const OLD_SYNC = ['bun node_modules/.bin/vulcan', 'sync'].join(' ');

describe('doctor and the prepare script', () => {
  test('a root package.json with no prepare script gets a note that prints the line; one that runs sync gets none; no package.json none', () => {
    const none = createProject({ files: { 'package.json': '{ "name": "x" }' } });
    const has = createProject({
      files: {
        'package.json': JSON.stringify({ scripts: { prepare: ProjectLayout.PREPARE_SCRIPT } }),
      },
    });
    const noPackage = createProject({ files: {} });
    const found = ProjectContract.checkPrepareScript(context(none));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('"prepare"');
    expect(found[0]?.message).toContain('vulcan project sync');
    expect(ProjectContract.checkPrepareScript(context(has))).toEqual([]);

    for (const script of [
      { postinstall: 'bun node_modules/.bin/vulcan project sync' },
      { prepare: 'make vulcan-sync' },
    ]) {
      const other = createProject({
        files: { 'package.json': JSON.stringify({ scripts: script }) },
      });

      expect(ProjectContract.checkPrepareScript(context(other))).toEqual([]);
    }

    expect(ProjectContract.checkPrepareScript(context(noPackage))).toEqual([]);
  });

  test('the old name in the install script is called out with the script to use; a script that has both forms is quiet', () => {
    const old = createProject({
      files: {
        'package.json': JSON.stringify({
          scripts: { prepare: `${OLD_SYNC} --quiet < /dev/null; exit 0` },
        }),
      },
    });
    const found = ProjectContract.checkPrepareScript(context(old));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('the old `sync` name');
    expect(found[0]?.message).toContain('vulcan project sync --quiet');

    const both = createProject({
      files: {
        'package.json': JSON.stringify({
          scripts: {
            prepare: `${OLD_SYNC} --quiet`,
            postinstall: 'bun node_modules/.bin/vulcan project sync --quiet',
          },
        }),
      },
    });

    expect(ProjectContract.checkPrepareScript(context(both))).toEqual([]);
  });

  test('git tracking .claude/settings.json is a warning with the git command; untracked is quiet', () => {
    const tracked = createProject({ files: { '.claude/settings.json': '{}\n' } });
    const untracked = createProject({ files: { '.claude/settings.json': '{}\n' } });

    for (const root of [tracked, untracked]) {
      Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    }

    Bun.spawnSync(['git', 'add', '-f', '.claude/settings.json'], { cwd: tracked });

    const found = ProjectContract.checkClaudeSettingsTracked(context(tracked));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('git rm --cached .claude/settings.json');
    expect(ProjectContract.checkClaudeSettingsTracked(context(untracked))).toEqual([]);
  });
});
