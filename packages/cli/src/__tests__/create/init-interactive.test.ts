import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeCommand } from '../fake-command.helper.ts';
import { createProject, packFolder, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const BACKEND = join(import.meta.dir, '..', 'fixtures', 'preset-backend');
const ANSWERS = ['my-product', 'services', 'core-api', 'libs'];
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** `script` gives the child a pseudo-terminal, so process.stdin.isTTY is true and the prompts run. */
const hasScript = Bun.which('script') !== null;

const runInTerminal = (opts: {
  cwd: string;
  args: string[];
  answers: string[];
  env: Record<string, string>;
}) => {
  const command = [process.execPath, CLI, ...opts.args].map(quote).join(' ');
  const child = spawnSyncBounded({
    cmd: ['script', '-qec', command, '/dev/null'],
    cwd: opts.cwd,
    env: { ...process.env, TERM: 'dumb', ...opts.env },
    stdin: Buffer.from(`${opts.answers.join('\n')}\n`),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: child.exitCode, output: child.stdout.toString() };
};

const initInTerminal = (opts: { answers: string[] }) => {
  const parent = createProject({ files: {} });
  const { code, output } = runInTerminal({
    cwd: parent,
    args: ['init', '--preset', `file:${BACKEND}`],
    answers: opts.answers,
    env: { VULCAN_NO_INSTALL: '1' },
  });

  return { root: join(parent, 'my-product'), code, output };
};

/**
 * A real `bun add` (it installs a file: tarball offline and prints its usual lines); every other
 * bun command is a no-op that prints a line of its own, so a stray line is visible in the output.
 */
const bunForNpmPreset = (): string =>
  createFakeCommand({
    body: `if [ "$1" = add ]; then exec '${process.execPath}' "$@"; fi\necho "bun $1 ran"\nexit 0`,
  });

/** The index of each text in the output, in the order given; a text that is missing is -1. */
const positions = (opts: { output: string; texts: string[] }): number[] =>
  opts.texts.map(text => opts.output.indexOf(text));

const isAscending = (opts: { values: number[] }): boolean =>
  opts.values.every(
    (value, index) => value >= 0 && (index === 0 || value > opts.values[index - 1]),
  );

describe.skipIf(!hasScript)('vulcan init --preset in a terminal', () => {
  test('the four prompts build the same project the flags build', () => {
    const { root, code, output } = initInTerminal({ answers: ANSWERS });

    expect(code).toBe(0);

    for (const question of [
      'Project name',
      'Backend folder',
      'Name of this backend app',
      'Shared code folder',
    ]) {
      expect(output).toContain(question);
    }

    expect(existsSync(join(root, 'services/core-api/package.json'))).toBe(true);
    expect(existsSync(join(root, 'libs/.gitkeep'))).toBe(true);
    expect(readFileSync(join(root, '.configs/vulcan.config.mts'), 'utf8')).toContain(
      '"backend": "services"',
    );
    expect(output).toContain('cd my-product && make dev');
  });

  test('an empty answer to the optional shared folder skips it', () => {
    const { root, code } = initInTerminal({ answers: ['my-product', 'services', 'core-api', ''] });

    expect(code).toBe(0);
    expect(existsSync(join(root, 'libs'))).toBe(false);
    expect(existsSync(join(root, 'services/core-api'))).toBe(true);
  });
});

describe.skipIf(!hasScript)('vulcan init --preset <npm package> in a terminal', () => {
  const initNpm = (opts: { answers: string[] }) => {
    const parent = createProject({ files: {} });
    const { code, output } = runInTerminal({
      cwd: parent,
      args: ['init', '--preset', `@fixture/backend@file:${packFolder({ folder: BACKEND })}`],
      answers: opts.answers,
      env: { VULCAN_BUN: bunForNpmPreset() },
    });

    return { root: join(parent, 'my-product'), code, output };
  };

  test('asks project, side folder, app, shared folder in that order, with the side named', () => {
    const { root, code, output } = initNpm({ answers: ANSWERS });

    expect(code).toBe(0);
    expect(
      isAscending({
        values: positions({
          output,
          texts: [
            'Project name',
            'Backend folder',
            'Name of this backend app',
            'Shared code folder',
          ],
        }),
      }),
    ).toBe(true);
    expect(output).not.toContain('Name of the first app');
    expect(existsSync(join(root, 'services/core-api/package.json'))).toBe(true);
  });

  test('the preset is fetched after the project name and before the folder question, in one line', () => {
    const { output } = initNpm({ answers: ANSWERS });

    expect(
      isAscending({
        values: positions({
          output,
          texts: ['Project name', 'Fetching preset @fixture/backend@', 'Backend folder'],
        }),
      }),
    ).toBe(true);
    expect(output.match(/Fetching preset/g)).toHaveLength(1);
  });

  test('the output of bun add is not printed between the prompts', () => {
    const { output } = initNpm({ answers: ANSWERS });

    expect(output).not.toContain('bun add');
    expect(output).not.toContain('packages installed');
  });

  test('the output of bun add is printed when the fetch fails', () => {
    const parent = createProject({ files: {} });
    const { code, output } = runInTerminal({
      cwd: parent,
      args: ['init', '--preset', '@fixture/missing@file:/no/such/folder.tgz'],
      answers: ['my-product'],
      env: { VULCAN_BUN: bunForNpmPreset() },
    });

    expect(code).not.toBe(0);
    expect(output).toContain('Fetching preset @fixture/missing@');
    expect(output).toMatch(/error|failed|ENOENT|not found/i);
    expect(existsSync(join(parent, 'my-product'))).toBe(false);
  });
});

describe.skipIf(!hasScript)('vulcan add --preset <npm package> in a terminal', () => {
  test('fetches quietly, then asks folder and app name', () => {
    const parent = createProject({ files: {} });
    const created = runCli({
      args: [
        'init',
        '--preset',
        `file:${BACKEND}`,
        '--project',
        'my-product',
        '--backend-dir',
        'services',
        '--app',
        'core-api',
      ],
      cwd: parent,
      env: { VULCAN_NO_INSTALL: '1' },
    });

    expect(created.code).toBe(0);

    const root = join(parent, 'my-product');
    const { code, output } = runInTerminal({
      cwd: root,
      args: ['add', '--preset', `@fixture/backend@file:${packFolder({ folder: BACKEND })}`],
      answers: ['', 'second-api'],
      env: { VULCAN_BUN: bunForNpmPreset() },
    });

    expect(code).toBe(0);
    expect(
      isAscending({
        values: positions({
          output,
          texts: [
            'Fetching preset @fixture/backend@',
            'Backend folder',
            'Name of this backend app',
          ],
        }),
      }),
    ).toBe(true);
    expect(output).not.toContain('bun add');
    expect(existsSync(join(root, 'services/second-api/package.json'))).toBe(true);
  });
});
