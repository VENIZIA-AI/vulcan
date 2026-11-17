import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitQueries } from '../../hooks/index.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

/** A repository whose configuration names a program for a filter, and whose tracked file looks changed to git. */
const withFilter = (): { root: string; ran: string } => {
  const root = createProject({ files: { 'a.txt': 'a', '.gitattributes': '*.txt filter=probe\n' } });

  initRepo({ cwd: root });

  const ran = join(root, '.git', 'ran');

  git({ cwd: root, args: ['config', 'filter.probe.clean', `sh -c "touch '${ran}'; cat"`] });
  // Newer than the index, so git looks at the content again.
  writeFileSync(join(root, 'a.txt'), 'a');
  utimesSync(join(root, 'a.txt'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));

  return { root, ran };
};

describe('GitQueries and the filters a repository names', () => {
  test('a status query does not run a filter the repository configuration names', () => {
    const { root, ran } = withFilter();

    GitQueries.run({ cwd: root, args: ['status', '--porcelain'] });

    expect(existsSync(ran)).toBe(false);
  });

  test('hashing a file for the trust check reads its bytes as they are, with no filter', () => {
    const { root, ran } = withFilter();

    expect(
      GitQueries.run({ cwd: root, args: ['hash-object', '--no-filters', '--', 'a.txt'] }),
    ).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(ran)).toBe(false);
  });

  test('a filter of the repository is told apart from a query that never reads content', () => {
    const { root } = withFilter();

    expect(GitQueries.hasRepositoryFilter({ cwd: root })).toBe(true);
    expect(GitQueries.run({ cwd: root, args: ['rev-parse', 'HEAD'] })).toMatch(/^[0-9a-f]{40}$/);
  });

  test('a repository with no filter is queried as before', () => {
    const root = createProject({ files: { 'a.txt': 'a' } });

    initRepo({ cwd: root });

    expect(GitQueries.hasRepositoryFilter({ cwd: root })).toBe(false);
    expect(GitQueries.run({ cwd: root, args: ['status', '--porcelain'] })).toBe('');
  });

  test('the variables that add configuration or another git are not passed on', () => {
    const before = { ...process.env };

    process.env['GIT_CONFIG_COUNT'] = '1';
    process.env['GIT_CONFIG_KEY_0'] = 'core.fsmonitor';
    process.env['GIT_CONFIG_VALUE_0'] = 'true';
    process.env['GIT_EXEC_PATH'] = '/nonexistent';
    process.env['GIT_EXTERNAL_DIFF'] = 'false';

    try {
      const env = GitQueries.environment();

      for (const name of [
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_KEY_0',
        'GIT_CONFIG_VALUE_0',
        'GIT_EXEC_PATH',
        'GIT_EXTERNAL_DIFF',
      ]) {
        expect(env[name], name).toBeUndefined();
      }
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in before)) {
          delete process.env[name];
        }
      }

      Object.assign(process.env, before);
    }
  });
});
