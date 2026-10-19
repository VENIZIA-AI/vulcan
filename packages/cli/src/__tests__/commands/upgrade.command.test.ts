import { afterAll, afterEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildUpgradeArgs,
  pickNightly,
  resolveUpgradeTarget,
  runInstalledSync,
} from '../../commands/upgrade.command.ts';
import { UpgradeFlags } from '../../common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);
afterEach(() => {
  delete process.env[UpgradeFlags.DIST_TAGS_ENV];
});

/** The registry read is replaced by this variable, so no test reaches npm. */
const withDistTags = (opts: { latest?: string; next?: string }): void => {
  process.env[UpgradeFlags.DIST_TAGS_ENV] = JSON.stringify(opts);
};

test('defaults to the latest dist-tag, pinned exactly, as a devDependency', () => {
  expect(buildUpgradeArgs({})).toEqual(['add', '--dev', '--exact', '@venizia/vulcan@latest']);
});

test('no argument and --stable both resolve to latest without reading the registry', async () => {
  expect(await resolveUpgradeTarget({ args: [], cwd: '/nowhere' })).toBe('latest');
  expect(await resolveUpgradeTarget({ args: ['--stable'], cwd: '/nowhere' })).toBe('latest');
});

test('--nightly installs next when it is ahead of latest', async () => {
  withDistTags({ latest: '0.2.0', next: '0.3.0-1' });
  expect(await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' })).toBe('0.3.0-1');
});

test('--nightly never goes below the stable release', async () => {
  withDistTags({ latest: '0.2.0', next: '0.2.0-9' });
  expect(await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' })).toBe('0.2.0');
});

test('--nightly falls back to the one tag that exists, and fails when there is none', async () => {
  withDistTags({ next: '0.3.0-1' });
  expect(await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' })).toBe('0.3.0-1');
  withDistTags({});
  expect(await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' })).toBeUndefined();
});

test('pickNightly compares prereleases by semver, not by text', () => {
  expect(pickNightly({ latest: '0.2.0', next: '0.2.1-10' })).toBe('0.2.1-10');
  expect(pickNightly({ latest: '0.2.0', next: '0.2.1-9' })).toBe('0.2.1-9');
  expect(pickNightly({ latest: '0.10.0', next: '0.9.0-1' })).toBe('0.10.0');
});

test('an explicit version or tag wins over the mode, and never reads the registry', async () => {
  expect(await resolveUpgradeTarget({ args: ['--nightly', '0.2.0'], cwd: '/nowhere' })).toBe(
    '0.2.0',
  );
  expect(await resolveUpgradeTarget({ args: ['next', '--stable'], cwd: '/nowhere' })).toBe('next');
});

test('--stable with --nightly is refused naming both, before anything is installed', () => {
  const root = createProject({ files: {} });
  const result = runCli({ args: ['upgrade', '--stable', '--nightly'], cwd: root });

  expect(result.code).toBe(1);
  expect(result.stderr).toContain('--stable and --nightly');
});

test('upgrade --nightly pins the resolved version (offline run)', () => {
  const root = createProject({ files: {} });
  const result = runCli({
    args: ['upgrade', '--nightly'],
    cwd: root,
    env: {
      VULCAN_NO_INSTALL: '1',
      [UpgradeFlags.DIST_TAGS_ENV]: '{"latest":"0.2.0","next":"0.3.0-1"}',
    },
  });

  expect(result.code).toBe(0);
  expect(result.stderr).toContain('skipped  bun add --dev --exact @venizia/vulcan@0.3.0-1');
});

test('takes an explicit version or tag', () => {
  expect(buildUpgradeArgs({ target: '0.2.0' })).toEqual([
    'add',
    '--dev',
    '--exact',
    '@venizia/vulcan@0.2.0',
  ]);
});

test('after the install, sync runs from the NEWLY installed CLI, not the one already loaded', async () => {
  const root = createProject({
    files: {
      'node_modules/.bin/vulcan':
        "#!/usr/bin/env bun\nawait Bun.write('sync-ran.txt', process.argv.slice(2).join(' '));\n",
    },
  });

  chmodSync(join(root, 'node_modules', '.bin', 'vulcan'), 0o755);
  expect(await runInstalledSync({ cwd: root })).toBe(0);
  expect(readFileSync(join(root, 'sync-ran.txt'), 'utf8')).toBe('sync');
});

test('no installed CLI after the install: exit 1, never a fallback to the old code', async () => {
  const root = createProject({ files: {} });

  expect(await runInstalledSync({ cwd: root })).toBe(1);
  expect(existsSync(join(root, '.claude'))).toBe(false);
});
