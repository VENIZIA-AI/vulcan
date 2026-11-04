import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectContract } from '../../doctor/checks.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = "export default { rules: { 'V-W-01': 'on-user-word' } };\n";
const LAUNCH_FILE = '.agents/local/claude.launch.settings.json';

describe('vulcan doctor: the launch file note', () => {
  const root = createProject({ files: { '.configs/vulcan.config.mts': CONFIG } });
  const notesOf = async (env: Record<string, string>): Promise<string[]> => {
    const notes = await DoctorRunner.runNotes({ root, env });

    return notes.filter((note) => note.file === LAUNCH_FILE).map((note) => note.message);
  };

  test('inside Claude Code with no CLAUDE_CODE_TMPDIR: the session did not use the launch file, and the command is named', async () => {
    const notes = await notesOf({ CLAUDECODE: '1' });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('not started with the launch file');
    expect(notes[0]).toContain(`claude --settings ${LAUNCH_FILE}`);
    expect(notes[0]).toContain('use /tmp.');
  });

  test('inside Claude Code with CLAUDE_CODE_TMPDIR on another folder: the same note', async () => {
    const result = await notesOf({ CLAUDECODE: '1', CLAUDE_CODE_TMPDIR: '/var/tmp/other' });

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('use /var/tmp/other.');
  });

  test("inside Claude Code with CLAUDE_CODE_TMPDIR on this project's own folder: nothing to say", async () => {
    const result = await notesOf({
      CLAUDECODE: '1',
      CLAUDE_CODE_TMPDIR: join(root, '.agents/local/tmp'),
    });
    expect(result).toEqual([]);
  });

  test('a trailing slash, a subfolder and a symlinked root are all inside', async () => {
    const own = join(root, '.agents/local/tmp');
    const link = `${root}-link`;

    mkdirSync(own, { recursive: true });
    symlinkSync(root, link);

    for (const [at, folder] of [
      [root, `${own}/`],
      [root, join(own, 'claude-1000')],
      [link, own],
      [root, join(link, '.agents/local/tmp')],
    ] as const) {
      const notes = await DoctorRunner.runNotes({
        root: at,
        env: { CLAUDECODE: '1', CLAUDE_CODE_TMPDIR: folder },
      });

      expect(
        notes.filter((note) => note.file === LAUNCH_FILE),
        `${at} with ${folder}`,
      ).toEqual([]);
    }
  });

  test('a folder beside the project, or the project itself without .agents/local, is outside', () => {
    // A project on no disk: the answer comes from the path alone, so it is the same in a worktree, where the
    // temp folder of the tests sits under another checkout.
    const project = '/srv/vulcan-fixture/checkout';

    for (const folder of [`${project}-other/.agents/local/tmp`, project, join(project, 'src')]) {
      const result = ProjectContract.checkLaunchSettings({
        root: project,
        env: { CLAUDECODE: '1', CLAUDE_CODE_TMPDIR: folder },
      });

      expect(result, folder).toHaveLength(1);
    }
  });

  test('outside Claude Code doctor cannot know, and says nothing', async () => {
    const result = await notesOf({});
    expect(result).toEqual([]);
    const result2 = await notesOf({ CLAUDE_CODE_TMPDIR: '/var/tmp/other' });
    expect(result2).toEqual([]);
  });
});
