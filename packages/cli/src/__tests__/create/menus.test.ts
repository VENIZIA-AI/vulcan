import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { driveTerminal, KEYS } from '../terminal.helper.ts';

afterAll(removeProjects);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const BACKEND = `file:${join(FIXTURES, 'preset-backend')}`;
const WITH_LIB = `file:${join(FIXTURES, 'preset-with-lib')}`;
const hasScript = Bun.which('script') !== null;
const ENV = { VULCAN_NO_INSTALL: '1', TERM: 'xterm-256color' };
const WRITE = 'Write these files?';

/** A monorepo made by init (flags, no terminal) from the preset that also makes libraries, shared folder `libs`. */
const monorepo = (): string => {
  const parent = createProject({ files: {} });

  runCli({
    args: [
      'init',
      '--preset',
      WITH_LIB,
      '--project',
      'p',
      '--backend-dir',
      'services',
      '--app',
      'core-api',
      '--shared-dir',
      'libs',
    ],
    cwd: parent,
    env: { VULCAN_NO_INSTALL: '1' },
  });

  return join(parent, 'p');
};

describe.skipIf(!hasScript)('vulcan init asks with menus in a terminal', () => {
  const initSteps = [
    { waitFor: 'Project name', send: `my-product${KEYS.ENTER}` },
    { waitFor: 'Backend folder', send: `services${KEYS.ENTER}` },
    { waitFor: 'Name of this backend app', send: `core-api${KEYS.ENTER}` },
    { waitFor: 'Shared code folder', send: `libs${KEYS.ENTER}` },
  ];

  test('typed names, then a summary, then a confirm, then the same project the flags build', async () => {
    const parent = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['init', '--preset', BACKEND],
      cwd: parent,
      env: ENV,
      steps: [...initSteps, { waitFor: WRITE, send: KEYS.ENTER }],
    });
    const root = join(parent, 'my-product');

    expect(result.code).toBe(0);
    expect(result.plain).toContain('services/core-api');
    expect(existsSync(join(root, 'services/core-api/package.json'))).toBe(true);
    expect(existsSync(join(root, 'libs/.gitkeep'))).toBe(true);
    expect(readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8')).toContain(
      '"backend": "services"',
    );
  });

  test('answering no at the summary writes nothing', async () => {
    const parent = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['init', '--preset', BACKEND],
      cwd: parent,
      env: ENV,
      steps: [...initSteps, { waitFor: WRITE, send: `n${KEYS.ENTER}` }],
    });

    expect(result.code).toBe(1);
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
    expect(result.plain).toContain('nothing was written');
  });

  test('a name that is not one is refused where it is typed, nothing is created', async () => {
    const parent = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['init', '--preset', BACKEND],
      cwd: parent,
      env: ENV,
      steps: [
        { waitFor: 'Project name', send: `My Product${KEYS.ENTER}` },
        { waitFor: 'is not a name', send: KEYS.CTRL_C },
      ],
    });

    expect(result.code).toBe(1);
    expect(existsSync(join(parent, 'My Product'))).toBe(false);
  });
});

describe.skipIf(!hasScript)('the preset is picked or typed when --preset is missing', () => {
  test('init --preset with no value picks an official preset or types another one', async () => {
    const parent = createProject({ files: {} });
    const result = await driveTerminal({
      args: ['init', '--preset'],
      cwd: parent,
      env: ENV,
      steps: [
        // Two official presets, then Another preset...: two downs reach it.
        { waitFor: 'Which preset', send: `${KEYS.DOWN}${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Preset (a package name', send: `${BACKEND}${KEYS.ENTER}` },
        { waitFor: 'Project name', send: `my-product${KEYS.ENTER}` },
        { waitFor: 'Backend folder', send: `services${KEYS.ENTER}` },
        { waitFor: 'Name of this backend app', send: `core-api${KEYS.ENTER}` },
        { waitFor: 'Shared code folder', send: KEYS.ENTER },
        { waitFor: WRITE, send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(result.plain).toContain('ignis');
    expect(result.plain).toContain('ardor');
    expect(result.plain).toContain('Another preset...');
    expect(existsSync(join(parent, 'my-product/services/core-api/package.json'))).toBe(true);
  });

  test('add lists the presets the project recorded, with what each builds', async () => {
    const root = monorepo();
    const result = await driveTerminal({
      args: ['add'],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'Which preset', send: KEYS.ENTER },
        { waitFor: 'What do you want to create?', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Name of this library', send: `billing${KEYS.ENTER}` },
        { waitFor: 'Folder', send: KEYS.ENTER },
        { waitFor: WRITE, send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(result.plain).toContain('preset-with-lib');
    expect(result.plain).toContain('ardor');
    expect(result.plain).toContain('Another preset...');
    expect(existsSync(join(root, 'libs/billing/package.json'))).toBe(true);
  });

  test('without a terminal a missing --preset is still the same error', () => {
    const root = monorepo();
    const result = runCli({ args: ['add'], cwd: root, env: { VULCAN_NO_INSTALL: '1' } });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--preset needs a value');
  });
});

describe.skipIf(!hasScript)('vulcan add asks with menus in a terminal', () => {
  test('kind is a select, the folder a select of the existing ones, then summary and confirm', async () => {
    const root = monorepo();
    const result = await driveTerminal({
      args: ['add', '--preset', WITH_LIB],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'What do you want to create?', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Name of this library', send: `billing${KEYS.ENTER}` },
        { waitFor: 'Folder', send: KEYS.ENTER },
        { waitFor: WRITE, send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(result.plain).toContain('a shared package');
    expect(result.plain).toContain('New folder...');
    expect(result.plain).toContain('libs/billing');
    expect(existsSync(join(root, 'libs/billing/package.json'))).toBe(true);
  });

  test('New folder... opens a text input for the folder', async () => {
    const root = monorepo();
    const result = await driveTerminal({
      args: ['add', '--preset', WITH_LIB],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'What do you want to create?', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Name of this library', send: `billing${KEYS.ENTER}` },
        { waitFor: 'Folder', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Folder', send: `tools${KEYS.ENTER}` },
        { waitFor: WRITE, send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'tools/billing/package.json'))).toBe(true);
  });

  test('an app keeps the side folder of the config without asking for it', async () => {
    const root = monorepo();
    const result = await driveTerminal({
      args: ['add', '--preset', WITH_LIB],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'What do you want to create?', send: KEYS.ENTER },
        { waitFor: 'Name of this backend app', send: `third-api${KEYS.ENTER}` },
        { waitFor: WRITE, send: KEYS.ENTER },
      ],
    });

    expect(result.code).toBe(0);
    expect(result.plain).not.toContain('Backend folder');
    expect(existsSync(join(root, 'services/third-api/package.json'))).toBe(true);
  });

  test('cancelling the kind menu stops with the two commands that would do it', async () => {
    const root = monorepo();
    const result = await driveTerminal({
      args: ['add', '--preset', WITH_LIB],
      cwd: root,
      env: ENV,
      steps: [{ waitFor: 'What do you want to create?', send: KEYS.CTRL_C }],
    });

    expect(result.code).toBe(1);
    expect(result.plain).toContain('say what to create');
    expect(existsSync(join(root, 'libs/billing'))).toBe(false);
  });

  test('no at the summary writes nothing', async () => {
    const root = monorepo();
    const result = await driveTerminal({
      args: ['add', '--preset', WITH_LIB],
      cwd: root,
      env: ENV,
      steps: [
        { waitFor: 'What do you want to create?', send: `${KEYS.DOWN}${KEYS.ENTER}` },
        { waitFor: 'Name of this library', send: `billing${KEYS.ENTER}` },
        { waitFor: 'Folder', send: KEYS.ENTER },
        { waitFor: WRITE, send: `n${KEYS.ENTER}` },
      ],
    });

    expect(result.code).toBe(1);
    expect(existsSync(join(root, 'libs/billing'))).toBe(false);
  });
});
