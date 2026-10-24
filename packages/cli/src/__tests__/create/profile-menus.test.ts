import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { driveTerminal, KEYS } from '../terminal.helper.ts';

afterAll(removeProjects);

const hasScript = Bun.which('script') !== null;
const ENV = { VULCAN_NO_INSTALL: '1', TERM: 'xterm-256color', LANG: 'en_US.UTF-8' };
const CONFIG = "export default { name: 'acme', rules: { 'V-W-01': 'on-user-word' } };\n";
const FILE = '.agents/local/profile.json';

const project = (): string =>
  createProject({
    files: {
      '.configs/vulcan.config.ts': CONFIG,
      '.gitignore': '.agents/local/\n',
      'package.json': '{}',
    },
  });

describe.skipIf(!hasScript)('vulcan profile in a terminal', () => {
  test('menus and text inputs, then the file', async () => {
    const root = project();
    const result = await driveTerminal({
      args: ['profile'],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'Reply language', send: KEYS.ENTER },
        { waitFor: 'How should I address you', send: `Sam${KEYS.ENTER}` },
        { waitFor: 'How should I refer to myself', send: KEYS.ENTER },
        { waitFor: 'How formal should I be', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Tone', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Reports: headline only', send: KEYS.ENTER },
        { waitFor: 'ask you first', send: `y${KEYS.ENTER}` },
        { waitFor: 'Propose commits', send: `n${KEYS.ENTER}` },
        { waitFor: 'Anything about how you like to work', send: `Be brief.${KEYS.ENTER}` },
        { waitFor: 'Taste in code', send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);

    const saved = JSON.parse(readFileSync(join(root, FILE), 'utf8'));

    expect(saved.language).toBe('en');
    expect(saved.address.you).toBe('Sam');
    // One Down from the default (neutral) is formal; for tone, friendly.
    expect(saved.address.formality).toBe('formal');
    expect(saved.tone).toBe('friendly');
    expect(saved.habits.askBeforeReversible).toBe(true);
    expect(saved.about).toBe('Be brief.');
  }, 60_000);

  test('Escape on a question cancels: nothing is written', async () => {
    const root = project();
    const result = await driveTerminal({
      args: ['profile'],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'Reply language', send: KEYS.ENTER },
        { waitFor: 'How should I address you', send: KEYS.ESCAPE },
      ],
    });

    expect(result.code).toBe(1);
    expect(result.plain).toContain('cancelled, nothing written');
    expect(existsSync(join(root, FILE))).toBe(false);
  }, 60_000);
});

describe.skipIf(!hasScript)('init offers the profile in a terminal', () => {
  test('a project with no profile is offered the form once; declining leaves no file', async () => {
    const root = createProject({ files: { 'package.json': '{"name":"p"}' } });
    const result = await driveTerminal({
      args: ['init'],
      cwd: root,
      env: ENV,
      steps: [{ waitFor: 'Tell VULCAN how you like to work', send: `n${KEYS.ENTER}` }],
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, FILE))).toBe(false);
  });

  test('accepting runs the form and the file is written inside the project', async () => {
    const root = createProject({ files: { 'package.json': '{"name":"p"}' } });
    const result = await driveTerminal({
      args: ['init'],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'Tell VULCAN how you like to work', send: KEYS.ENTER },
        { waitFor: 'Reply language', send: KEYS.ENTER },
        { waitFor: 'How should I address you', send: KEYS.ENTER },
        { waitFor: 'How should I refer to myself', send: KEYS.ENTER },
        { waitFor: 'How formal should I be', send: KEYS.ENTER },
        { waitFor: 'Tone', send: KEYS.ENTER },
        { waitFor: 'Reports: headline only', send: KEYS.ENTER },
        { waitFor: 'ask you first', send: KEYS.ENTER },
        { waitFor: 'Propose commits', send: KEYS.ENTER },
        { waitFor: 'Anything about how you like to work', send: KEYS.ENTER },
        { waitFor: 'Taste in code', send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, FILE), 'utf8')).tone).toBe('neutral');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.agents/local/');
  }, 60_000);

  test('without a terminal init only says how to run the form', () => {
    const root = createProject({ files: { 'package.json': '{"name":"p"}' } });
    const child = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, '..', '..', 'cli.ts'), 'init'],
      {
        cwd: root,
        env: { ...process.env, VULCAN_NO_INSTALL: '1', TERM: 'dumb' },
      },
    );

    expect(child.stderr.toString()).toContain("run 'bun x --no-install vulcan profile'");
    expect(existsSync(join(root, FILE))).toBe(false);
  });
});
