import { afterAll, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUpgradeArgs, runInstalledSync } from '../../commands/upgrade.command.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

test('defaults to the next dist-tag, pinned exactly, as a devDependency', () => {
  expect(buildUpgradeArgs({})).toEqual(['add', '--dev', '--exact', '@venizia/vulcan@next']);
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
