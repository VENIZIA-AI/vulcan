import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const BACKEND = join(import.meta.dir, '..', 'fixtures', 'preset-backend');
const ANSWERS = ['my-product', 'services', 'core-api', 'libs'];
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** `script` gives the child a pseudo-terminal, so process.stdin.isTTY is true and the prompts run. */
const hasScript = Bun.which('script') !== null;

const initInTerminal = (opts: { answers: string[] }) => {
  const parent = createProject({ files: {} });
  const command = [process.execPath, CLI, 'init', '--preset', `file:${BACKEND}`]
    .map(quote)
    .join(' ');
  const child = spawnSyncBounded({
    cmd: ['script', '-qec', command, '/dev/null'],
    cwd: parent,
    env: { ...process.env, VULCAN_NO_INSTALL: '1' },
    stdin: Buffer.from(`${opts.answers.join('\n')}\n`),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    root: join(parent, 'my-product'),
    code: child.exitCode,
    output: child.stdout.toString(),
  };
};

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
