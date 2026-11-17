import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorRunner } from '../../doctor/index.ts';
import { SocketWarning } from '../doctor/socket-warning.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

/** A project as it was before `.agents/local/` existed: an old `.gitignore`, no local workspace. */
const PRE_UPGRADE = {
  '.configs/vulcan.config.mts': "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
  'AGENTS.md': '# x\n',
  '.gitignore': 'node_modules/\n.agents/vulcan.local.json\n',
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
    const before = await DoctorRunner.runWarnings({ root });

    expect(before.some((entry) => entry.check === 'local')).toBe(true);

    runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    const result = await DoctorRunner.runWarnings({ root });
    const after = SocketWarning.without({ warnings: result });

    expect(after.filter((entry) => entry.check === 'local')).toEqual([]);
  });
});
