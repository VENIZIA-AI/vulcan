import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'cli.ts');

const run = (opts: { args: string[] }) => {
  const child = Bun.spawnSync([process.execPath, CLI, ...opts.args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
};

describe('vulcan-okf dispatcher', () => {
  test('no command prints the usage and exits 2', () => {
    const result = run({ args: [] });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage: vulcan x okf');
  });

  test('an unknown command exits 2 with the usage', () => {
    const result = run({ args: ['nope'] });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('check|gen|coverage|viz');
  });

  test('the table generators are atlas commands, not okf ones', () => {
    const result = run({ args: ['symbols'] });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage: vulcan x okf <check|gen|coverage|viz>');
  });
});
