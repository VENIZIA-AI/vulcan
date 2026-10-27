import { afterAll, describe, expect, test } from 'bun:test';
import { runDoctorWarnings } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

const CONFIG = "export default { name: 'acme', rules: { 'V-W-01': 'read-only' } };\n";
const profileWarnings = async (opts: { root: string }) =>
  (await runDoctorWarnings({ root: opts.root })).filter((entry) => entry.check === 'profile');

describe('doctor and the personal profile', () => {
  test('no profile, or a good one, is quiet', async () => {
    const none = createProject({ files: { '.configs/vulcan.config.ts': CONFIG } });
    const good = createProject({
      files: {
        '.configs/vulcan.config.ts': CONFIG,
        '.gitignore': '.agents/local/\n',
        '.agents/local/profile.json': JSON.stringify({ schemaVersion: 1 }),
      },
    });

    expect(await profileWarnings({ root: none })).toEqual([]);
    expect(await profileWarnings({ root: good })).toEqual([]);
  });

  test('a profile git would pick up is flagged with the fix', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': CONFIG,
        '.gitignore': 'node_modules/\n',
        '.agents/local/profile.json': JSON.stringify({ schemaVersion: 1 }),
      },
    });
    const [warning] = await profileWarnings({ root });

    expect(warning?.message).toContain('does not ignore this personal file');
  });

  test('a profile that cannot be read is named with the way out', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': CONFIG, '.agents/local/profile.json': '{ nope' },
    });
    const [warning] = await profileWarnings({ root });

    expect(warning?.file).toBe('.agents/local/profile.json');
    expect(warning?.message).toContain('is not valid JSON');
  });

  test('a profile git tracks is flagged with the command that untracks it', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': CONFIG,
        '.gitignore': '.agents/local/\n',
        '.agents/local/profile.json': JSON.stringify({ schemaVersion: 1 }),
      },
    });

    for (const args of [
      ['init', '-q'],
      ['add', '-f', '.agents/local/profile.json'],
    ]) {
      expect(spawnSyncBounded({ cmd: ['git', ...args], cwd: root }).exitCode).toBe(0);
    }

    const messages = (await profileWarnings({ root })).map((warning) => warning.message);

    expect(
      messages.some((message) => message.includes('git rm --cached .agents/local/profile.json')),
    ).toBe(true);
  });
});
