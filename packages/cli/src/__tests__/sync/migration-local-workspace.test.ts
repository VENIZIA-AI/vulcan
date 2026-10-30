import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDoctorWarnings } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

/** A project as it was before `.agents/local/` existed: an old `.gitignore`, no local workspace. */
const PRE_UPGRADE = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
  'AGENTS.md': '# x\n',
  '.gitignore': 'node_modules/\n.agents/vulcan.local.json\n',
};

const git = (opts: { cwd: string; args: string[] }): void => {
  const result = spawnSyncBounded({
    cmd: ['git', ...opts.args],
    cwd: opts.cwd,
    timeout: 20_000,
  });

  expect(result.exitCode).toBe(0);
};

describe('upgrading a project from the layout before .agents/local/', () => {
  test('one sync creates the local workspace and gitignores it, with nothing done by hand', () => {
    const root = createProject({ files: PRE_UPGRADE });
    const result = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\n.agents/vulcan.local.json\n.agents/local/\n',
    );

    for (const name of ['tmp', 'worktrees', 'clones', 'cache', 'reports', 'prototypes']) {
      expect(existsSync(join(root, '.agents/local', name))).toBe(true);
    }
  });

  test('a second sync changes nothing in the workspace or the gitignore', () => {
    const root = createProject({ files: PRE_UPGRADE });

    runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
    const again = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(again.code).toBe(0);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(ignore);
  });

  test('doctor warns before the sync and is quiet after it', async () => {
    const root = createProject({ files: PRE_UPGRADE });
    const before = await runDoctorWarnings({ root });

    expect(before.some((entry) => entry.check === 'local')).toBe(true);

    runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    const after = await runDoctorWarnings({ root });

    expect(after.filter((entry) => entry.check === 'local')).toEqual([]);
  });

  test('a worktree outside the project is named with the exact command to move it in', async () => {
    const root = createProject({ files: PRE_UPGRADE });
    const outside = join(createProject({ files: {} }), 'elsewhere');

    git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
    git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
    git({ cwd: root, args: ['config', 'user.name', 'a'] });
    git({ cwd: root, args: ['add', '.'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'init'] });
    git({ cwd: root, args: ['worktree', 'add', '-q', outside, '-b', 'topic'] });
    runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    const result = await runDoctorWarnings({ root });
    const warnings = result.filter((entry) => entry.check === 'local');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(`git worktree move '${outside}'`);
    expect(warnings[0]?.message).toContain('.agents/local/worktrees/elsewhere');
    // Nothing was moved or removed.
    expect(existsSync(outside)).toBe(true);
  });
});
