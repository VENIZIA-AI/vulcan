import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandScopes } from '../../commands/scopes.ts';
import { createFakeCommand } from '../fake-command.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const WITH_LIB = `file:${join(import.meta.dir, '..', 'fixtures', 'preset-with-lib')}`;

/** A `bun` that records its arguments, one line per call, and succeeds: the installed `vulcan` is never really run. */
const recordingBun = (): { bun: string; calls: () => string[][] } => {
  const dir = createProject({ files: { 'calls.log': '' } });
  const log = join(dir, 'calls.log');

  return {
    bun: createFakeCommand({ body: `printf '%s\\n' "$*" >> '${log}'\nexit 0` }),
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split(' ')),
  };
};

/** What the project's own `vulcan` was asked to run: the words after the bin, from the recorded calls. */
const vulcanCalls = (calls: string[][]): string[][] =>
  calls
    .filter((call) => call[0]?.endsWith('/node_modules/.bin/vulcan'))
    .map((call) => call.slice(1));

describe('the commands a command starts', () => {
  test('init --preset, package add --lib and package add --app start the installed vulcan by names the router answers without a notice', () => {
    const { bun, calls } = recordingBun();
    const env = { VULCAN_BUN: bun };
    const parent = createProject({ files: {} });
    const init = runCli({
      args: [
        'project',
        'init',
        '--preset',
        WITH_LIB,
        '--project',
        'p',
        '--key',
        'TEST',
        '--backend-dir',
        'services',
        '--shared-dir',
        'libs',
        '--app',
        'core-api',
      ],
      cwd: parent,
      env,
    });

    expect(init.code, init.stderr).toBe(0);

    const root = join(parent, 'p');
    const lib = runCli({
      args: ['package', 'add', '--preset', WITH_LIB, '--lib', 'billing'],
      cwd: root,
      env,
    });
    const app = runCli({
      args: ['package', 'add', '--preset', WITH_LIB, '--app', 'worker'],
      cwd: root,
      env,
    });

    expect(lib.code, lib.stderr).toBe(0);
    expect(app.code, app.stderr).toBe(0);
    expect(`${init.stderr}${lib.stderr}${app.stderr}`).not.toContain(' is now vulcan ');

    const started = vulcanCalls(calls());

    // Each of the three runs syncs and checks: the words are the public ones.
    expect(started.filter((words) => words.join(' ') === 'project sync')).toHaveLength(3);
    expect(started.filter((words) => words.join(' ') === 'project doctor')).toHaveLength(3);
    expect(started.filter((words) => words.join(' ') === 'okf check --strict')).toHaveLength(3);

    for (const words of started) {
      const resolved = CommandScopes.resolve({ argv: words });

      expect(resolved?.type, words.join(' ')).toBe('run');
    }
  });

  test('every pair of the scope table gives words the router runs, and a pair it does not know throws', () => {
    for (const entry of CommandScopes.COMMANDS) {
      const words = CommandScopes.argvOf({ scope: entry.scope, action: entry.action });

      expect(CommandScopes.resolve({ argv: words })?.type, words.join(' ')).toBe('run');
    }

    expect(() => CommandScopes.argvOf({ scope: 'project', action: 'frobnicate' })).toThrow(
      "no command 'project frobnicate'",
    );
  });
});
