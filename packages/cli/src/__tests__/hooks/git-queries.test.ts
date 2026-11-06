import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitQueries } from '../../hooks/index.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const repository = (opts: { files?: Record<string, string> } = {}): string => {
  const root = createProject({ files: opts.files ?? { 'a.txt': 'a' } });

  initRepo({ cwd: root });

  return root;
};

describe('GitQueries.run', () => {
  test('answers a question about the checkout in cwd', () => {
    const root = repository();

    expect(GitQueries.run({ cwd: root, args: ['ls-files'] })).toBe('a.txt');
    expect(
      GitQueries.run({ cwd: root, args: ['rev-parse', '--verify', 'nothing'] }),
    ).toBeUndefined();
  });

  test('runs no program the configuration names for the file system monitor', () => {
    const root = repository();
    const ran = join(root, '.git', 'ran');

    git({ cwd: root, args: ['config', 'core.fsmonitor', `touch '${ran}'; false`] });

    expect(GitQueries.run({ cwd: root, args: ['status', '--porcelain'] })).toBe('');
    expect(existsSync(ran)).toBe(false);
  });

  test('runs no hook of the repository when the index would be rewritten', () => {
    const root = repository();
    const ran = join(root, '.git', 'ran');
    const hook = join(root, '.git', 'hooks', 'post-index-change');

    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    writeFileSync(hook, `#!/bin/sh\ntouch '${ran}'\n`);
    chmodSync(hook, 0o755);
    // A newer time stamp makes git refresh its index entry, which it writes back unless it is told not to.
    utimesSync(join(root, 'a.txt'), new Date(), new Date(Date.now() + 5000));

    expect(GitQueries.run({ cwd: root, args: ['status', '--porcelain'] })).toBe('');
    expect(existsSync(ran)).toBe(false);
  });

  test('is about the checkout in cwd even when the environment points git elsewhere', () => {
    const root = repository({ files: { 'here.txt': 'here' } });
    const other = repository({ files: { 'there.txt': 'there' } });
    const before = { ...process.env };

    try {
      process.env.GIT_DIR = join(other, '.git');
      process.env.GIT_WORK_TREE = other;

      expect(GitQueries.run({ cwd: root, args: ['ls-files'] })).toBe('here.txt');
    } finally {
      process.env.GIT_DIR = before.GIT_DIR;
      process.env.GIT_WORK_TREE = before.GIT_WORK_TREE;

      if (before.GIT_DIR === undefined) {
        delete process.env.GIT_DIR;
      }

      if (before.GIT_WORK_TREE === undefined) {
        delete process.env.GIT_WORK_TREE;
      }
    }
  });

  test('is undefined for a program that is not installed', () => {
    expect(
      GitQueries.run({ program: 'vulcan-no-such-program', cwd: '/', args: [] }),
    ).toBeUndefined();
  });
});
