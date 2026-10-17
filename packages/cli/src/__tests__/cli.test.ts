import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './run.helper.ts';

const readVersion = (opts: { packageDirectory: string }): string =>
  JSON.parse(
    readFileSync(
      join(import.meta.dir, '..', '..', '..', opts.packageDirectory, 'package.json'),
      'utf8',
    ),
  ).version;

describe('vulcan router', () => {
  test('help lists every command, in the bun x form', () => {
    const result = runCli({ args: ['help'], cwd: tmpdir() });

    expect(result.code).toBe(0);

    for (const command of ['init', 'sync', 'doctor', 'upgrade', 'x']) {
      expect(result.stdout).toContain(command);
    }

    expect(result.stdout).toContain('bun x vulcan');
    expect(result.stdout).not.toContain('bunx');
  });

  test('no command prints the help', () => {
    expect(runCli({ args: [], cwd: tmpdir() }).stdout).toContain('Usage: bun x vulcan');
  });

  test('version prints the package version', () => {
    const result = runCli({ args: ['version'], cwd: tmpdir() });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(readVersion({ packageDirectory: 'cli' }));
  });

  test('an unknown command exits 1, points at help on stderr, and writes nothing to stdout', () => {
    const result = runCli({ args: ['frobnicate'], cwd: tmpdir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command 'frobnicate'");
    expect(result.stdout).toBe('');
  });

  test('one release train: cli, okf and atlas carry the same version', () => {
    expect(readVersion({ packageDirectory: 'okf' })).toBe(readVersion({ packageDirectory: 'cli' }));
    expect(readVersion({ packageDirectory: 'atlas' })).toBe(
      readVersion({ packageDirectory: 'cli' }),
    );
  });
});
