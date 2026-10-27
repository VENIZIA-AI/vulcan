import { afterAll, describe, expect, test } from 'bun:test';
import { runDoctorNotes } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const project = (opts: { config: object }): string =>
  createProject({
    files: { '.configs/vulcan.config.ts': `export default ${JSON.stringify(opts.config)};\n` },
  });

describe('doctor shows the patterns the project lists', () => {
  test('one note per command and one for the push targets, with the rule and the pattern', async () => {
    const notes = await runDoctorNotes({
      root: project({
        config: {
          guard: {
            writes: {
              commands: [
                { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' },
                { rule: 'V-W-02', what: 'running a migration', pattern: '\\bbun run migrate:' },
              ],
            },
            git: { askPush: ['develop', 'release/*'] },
          },
        },
      }),
    });
    const guard = notes.filter((note) => note.check === 'guards').map((note) => note.message);

    expect(guard).toHaveLength(3);
    expect(guard.join('\n')).toContain('V-W-03');
    expect(guard.join('\n')).toContain('deploying');
    expect(guard.join('\n')).toContain('\\bmake deploy-');
    expect(guard.join('\n')).toContain('V-W-02');
    expect(guard.join('\n')).toContain('develop, release/*');
  });

  test('says nothing when the project lists none', async () => {
    const notes = await runDoctorNotes({ root: project({ config: {} }) });

    expect(notes.filter((note) => note.check === 'guards')).toEqual([]);
  });
});
