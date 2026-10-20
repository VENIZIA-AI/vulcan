import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { clearProjectConfig, useProjectConfig } from './project.helper.ts';
import { spawnSyncBounded } from './spawn.helper.ts';

afterEach(clearProjectConfig);

const CLI = join(import.meta.dir, '..', 'cli.ts');

const run = (opts: { args: string[] }) => {
  const child = spawnSyncBounded({
    cmd: [process.execPath, CLI, ...opts.args],
    // Explicit: a spawn does not see process.env changes made after startup (useProjectConfig).
    env: { ...process.env },
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

describe('outside vulcan x', () => {
  test('a command without a project config stops with what to do, never a stack trace', () => {
    const result = run({ args: ['check'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('okf: no project config - run through `vulcan x okf`');
    expect(result.stderr).not.toContain('    at ');
  });

  test('a VULCAN_CONFIG that is not JSON stops with what to do, never a stack trace', () => {
    process.env.VULCAN_CONFIG = '';
    process.env.VULCAN_PROJECT_ROOT = join(import.meta.dir, 'fixtures', 'sources');
    const result = run({ args: ['check'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'okf: VULCAN_CONFIG is not valid JSON - run okf through `vulcan x`',
    );
    expect(result.stderr).not.toContain('    at ');
  });
});

describe('gen', () => {
  test('nothing configured: it says so and writes nothing', () => {
    useProjectConfig({ root: join(import.meta.dir, 'fixtures', 'sources'), config: {} });
    const result = run({ args: ['gen'] });

    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith(
      'gen: nothing configured - okf.renderers and okf.regions are empty; add a renderer',
    );
  });
});
