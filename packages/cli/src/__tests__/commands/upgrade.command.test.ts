import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildUpgradeArgs,
  pickNightly,
  resolveUpgradeTarget,
  runInstalledSync,
} from '../../commands/upgrade.command.ts';
import { UpgradeFlags } from '../../common/index.ts';
import { createFakeCommand } from '../fake-command.helper.ts';
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
  const result = await resolveUpgradeTarget({ args: [], cwd: '/nowhere' });
  expect(result).toBe('latest');
  const result2 = await resolveUpgradeTarget({ args: ['--stable'], cwd: '/nowhere' });
  expect(result2).toBe('latest');
});

test('--nightly installs next when it is ahead of latest', async () => {
  withDistTags({ latest: '0.2.0', next: '0.3.0-1' });
  const result = await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' });
  expect(result).toBe('0.3.0-1');
});

test('--nightly never goes below the stable release', async () => {
  withDistTags({ latest: '0.2.0', next: '0.2.0-9' });
  const result = await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' });
  expect(result).toBe('0.2.0');
});

test('--nightly falls back to the one tag that exists, and fails when there is none', async () => {
  withDistTags({ next: '0.3.0-1' });
  const result = await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' });
  expect(result).toBe('0.3.0-1');
  withDistTags({});
  const result2 = await resolveUpgradeTarget({ args: ['--nightly'], cwd: '/nowhere' });
  expect(result2).toBeUndefined();
});

test('pickNightly compares prereleases by semver, not by text', () => {
  expect(pickNightly({ latest: '0.2.0', next: '0.2.1-10' })).toBe('0.2.1-10');
  expect(pickNightly({ latest: '0.2.0', next: '0.2.1-9' })).toBe('0.2.1-9');
  expect(pickNightly({ latest: '0.10.0', next: '0.9.0-1' })).toBe('0.10.0');
});

test('an explicit version or tag wins over the mode, and never reads the registry', async () => {
  const result = await resolveUpgradeTarget({ args: ['--nightly', '0.2.0'], cwd: '/nowhere' });
  expect(result).toBe('0.2.0');
  const result2 = await resolveUpgradeTarget({ args: ['next', '--stable'], cwd: '/nowhere' });
  expect(result2).toBe('next');
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

const NIGHTLY_FAILURE = 'could not read the dist-tags of @venizia/vulcan';

describe('--nightly with an unusable registry answer', () => {
  const runNightly = (opts: { tags: string }) =>
    runCli({
      args: ['upgrade', '--nightly'],
      cwd: createProject({ files: {} }),
      env: { VULCAN_NO_INSTALL: '1', [UpgradeFlags.DIST_TAGS_ENV]: opts.tags },
    });

  for (const [name, tags] of [
    ['a non-semver latest', '{"latest":"banana","next":"0.3.0-1"}'],
    ['a non-semver next', '{"latest":"0.2.0","next":"soon"}'],
    ['a tag that is not text', '{"latest":2}'],
    ['null', 'null'],
    ['an array', '["0.2.0"]'],
    ['a string', '"0.2.0"'],
    ['text that is not JSON', 'oops'],
  ]) {
    test(`${name}: the dist-tags message and exit 1, never a crash`, () => {
      const result = runNightly({ tags });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(NIGHTLY_FAILURE);
      expect(result.stderr).not.toContain('error:');
      expect(result.stderr).not.toContain('skipped  bun add');
    });
  }

  test('extra tags of any shape are ignored', () => {
    const result = runNightly({ tags: '{"latest":"0.2.0","beta":7}' });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('@venizia/vulcan@0.2.0');
  });
});

test('when bun pm view fails its own stderr is printed', () => {
  const result = runCli({
    args: ['upgrade', '--nightly'],
    cwd: createProject({ files: {} }),
    env: {
      VULCAN_BUN: createFakeCommand({ body: 'echo "registry unreachable: 401" >&2; exit 1' }),
    },
  });

  expect(result.code).toBe(1);
  expect(result.stderr).toContain('registry unreachable: 401');
  expect(result.stderr).toContain(NIGHTLY_FAILURE);
});

describe('an installed prerelease on the stable channel', () => {
  const NOTE = '--nightly keeps the prerelease line';
  const withInstalled = (opts: { version: string }): string =>
    createProject({
      files: {
        'node_modules/@venizia/vulcan/package.json': JSON.stringify({
          name: '@venizia/vulcan',
          version: opts.version,
        }),
      },
    });
  const upgrade = (opts: { root: string; args: string[] }) =>
    runCli({ args: ['upgrade', ...opts.args], cwd: opts.root, env: { VULCAN_NO_INSTALL: '1' } });

  test('prints one note naming the installed version', () => {
    const result = upgrade({ root: withInstalled({ version: '0.3.0-2' }), args: [] });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('0.3.0-2');
    expect(result.stderr.split(NOTE).length - 1).toBe(1);
  });

  test('--stable prints it too', () => {
    expect(
      upgrade({ root: withInstalled({ version: '0.3.0-2' }), args: ['--stable'] }).stderr,
    ).toContain(NOTE);
  });

  test('a stable install, --nightly and an explicit version print none', () => {
    expect(upgrade({ root: withInstalled({ version: '0.3.0' }), args: [] }).stderr).not.toContain(
      NOTE,
    );
    expect(
      upgrade({ root: withInstalled({ version: '0.3.0-2' }), args: ['0.4.0'] }).stderr,
    ).not.toContain(NOTE);
    expect(upgrade({ root: createProject({ files: {} }), args: [] }).stderr).not.toContain(NOTE);
  });
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
  const result = await runInstalledSync({ cwd: root });
  expect(result).toBe(0);
  expect(readFileSync(join(root, 'sync-ran.txt'), 'utf8')).toBe('sync');
});

test('no installed CLI after the install: exit 1, never a fallback to the old code', async () => {
  const root = createProject({ files: {} });

  const result = await runInstalledSync({ cwd: root });
  expect(result).toBe(1);
  expect(existsSync(join(root, '.claude'))).toBe(false);
});
