import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { driveTerminal, hasColour, KEYS } from '../terminal.helper.ts';

afterAll(removeProjects);

const hasScript = Bun.which('script') !== null;
const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const LOCAL = '.agents/vulcan.local.json';

/** A PATH holding bun and the system tools only, so the agents of the machine running the tests are not detected. */
const barePath = (): string => {
  const bin = createProject({ files: {} });

  symlinkSync(process.execPath, join(bin, 'bun'));

  return `${bin}:/usr/bin:/bin`;
};

const storedAgents = (opts: { root: string }): string[] =>
  JSON.parse(readFileSync(join(opts.root, LOCAL), 'utf8')).agents;

describe.skipIf(!hasScript)('vulcan sync asks the agents as a checkbox menu', () => {
  const env = (opts: { home: string }): Record<string, string> => ({
    HOME: opts.home,
    PATH: barePath(),
    TERM: 'xterm-256color',
  });

  test('space ticks the line under the cursor, enter stores what is ticked', async () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: { '.codex/config.toml': '' } });
    const result = await driveTerminal({
      args: ['sync'],
      cwd: root,
      env: env({ home }),
      steps: [
        { waitFor: 'Which coding agents', send: KEYS.SPACE },
        { waitFor: 'Claude Code', send: KEYS.DOWN },
        { waitFor: 'omp', send: KEYS.SPACE },
        { waitFor: 'omp', send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(storedAgents({ root }).sort()).toEqual(['claude', 'codex', 'omp'].sort());
    expect(result.plain).toContain('detected');
    expect(hasColour({ output: result.output })).toBe(true);
  });

  test('what was chosen before is ticked, so enter alone keeps it', async () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: {} });

    runCli({ args: ['sync', '--agents', 'omp,pi'], cwd: root });
    // A stored choice is read, not asked: the menu is reached through the flag with no value.
    const result = await driveTerminal({
      args: ['sync', '--agents'],
      cwd: root,
      env: env({ home }),
      steps: [{ waitFor: 'chosen before', send: KEYS.ENTER }],
    });

    expect(result.code).toBe(0);
    expect(storedAgents({ root })).toEqual(['omp', 'pi']);
  });

  test('cancelling stops the command and stores nothing', async () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['sync'],
      cwd: root,
      env: env({ home }),
      steps: [{ waitFor: 'Which coding agents', send: KEYS.CTRL_C }],
    });

    expect(result.code).toBe(1);
    expect(existsSync(join(root, LOCAL))).toBe(false);
    expect(result.plain).toContain('no answer');
  });

  test('NO_COLOR leaves the menu without colour sequences', async () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['sync'],
      cwd: root,
      env: { ...env({ home }), NO_COLOR: '1' },
      steps: [{ waitFor: 'Which coding agents', send: KEYS.ENTER }],
    });

    expect(result.code).toBe(0);
    expect(hasColour({ output: result.output })).toBe(false);
  });
});
