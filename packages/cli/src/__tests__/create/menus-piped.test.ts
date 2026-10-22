import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { driveTerminal, KEYS } from '../terminal.helper.ts';

afterAll(removeProjects);

const hasScript = Bun.which('script') !== null;
const ENV = { VULCAN_NO_INSTALL: '1', TERM: 'xterm-256color' };
const LF = '\n';
const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const BACKEND = `file:${join(import.meta.dir, '..', 'fixtures', 'preset-backend')}`;

// A pty that is fed piped lines (`printf ... | script`) sends LF, which a keyboard in raw mode never
// does for Enter. A menu waits for CR, so it used to wait forever (a 40 minute hang in a preset smoke).
describe.skipIf(!hasScript)('a menu that is fed piped lines stops instead of waiting', () => {
  test('the agents checkbox: LF ends the command at once with the way out, and stores nothing', async () => {
    const root = createProject({ files: PROJECT });
    const started = Date.now();
    const result = await driveTerminal({
      args: ['sync'],
      cwd: root,
      env: { ...ENV, HOME: createProject({ files: {} }) },
      steps: [{ waitFor: 'Which coding agents', send: LF }],
    });

    expect(result.code).toBe(1);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.plain).toContain('reads key presses, not lines');
    expect(result.plain).toContain('TERM=dumb');
    expect(result.plain).toContain('--agents');
    expect(existsSync(join(root, '.agents/vulcan.local.json'))).toBe(false);
  });

  test('a text prompt: the typed name followed by LF stops the command, nothing is written', async () => {
    const parent = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['init', '--preset', BACKEND],
      cwd: parent,
      env: ENV,
      steps: [{ waitFor: 'Project name', send: `my-product${LF}` }],
    });

    expect(result.code).toBe(1);
    expect(result.plain).toContain('reads key presses, not lines');
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });

  test('a real Enter (CR) still works, and so does TERM=dumb with piped lines', async () => {
    const root = createProject({ files: PROJECT });
    const menu = await driveTerminal({
      args: ['sync'],
      cwd: root,
      env: { ...ENV, HOME: createProject({ files: {} }) },
      steps: [{ waitFor: 'Which coding agents', send: KEYS.ENTER }],
    });

    expect(menu.code).toBe(0);
    expect(readFileSync(join(root, '.agents/vulcan.local.json'), 'utf8')).toContain('agents');

    const plain = createProject({ files: PROJECT });
    const piped = await driveTerminal({
      args: ['sync'],
      cwd: plain,
      env: { ...ENV, TERM: 'dumb', HOME: createProject({ files: {} }) },
      steps: [{ waitFor: 'Agents >', send: `claude${LF}` }],
    });

    expect(piped.code).toBe(0);
  });
});
