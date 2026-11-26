import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateFlags } from '../create/common/index.ts';
import { createProject, removeProjects } from './project.helper.ts';
import { runCli } from './run.helper.ts';

afterAll(removeProjects);

const readVersion = (opts: { packageDirectory: string }): string =>
  JSON.parse(
    readFileSync(
      join(import.meta.dir, '..', '..', '..', opts.packageDirectory, 'package.json'),
      'utf8',
    ),
  ).version;

describe('vulcan router', () => {
  test('help lists every command, in the bun run form', () => {
    const result = runCli({ args: ['help'], cwd: tmpdir() });

    expect(result.code).toBe(0);

    for (const command of ['init', 'sync', 'doctor', 'upgrade', 'x']) {
      expect(result.stdout).toContain(command);
    }

    expect(result.stdout).toContain('bun node_modules/.bin/vulcan');
    expect(result.stdout).not.toMatch(/\bbunx vulcan/);
  });

  test('no command prints the help', () => {
    expect(runCli({ args: [], cwd: tmpdir() }).stdout).toContain(
      'Usage: bun node_modules/.bin/vulcan',
    );
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

  test('--help after a command prints the help and runs nothing', () => {
    const cwd = createProject({ files: { '.configs/vulcan.config.mts': 'export default {};\n' } });

    for (const args of [
      ['project', 'sync', '--help'],
      ['project', 'doctor', '-h'],
      ['project', 'init', '--help'],
      ['project', 'upgrade', '--help'],
    ]) {
      const result = runCli({ args, cwd });

      expect(result.code, args.join(' ')).toBe(0);
      expect(result.stdout, args.join(' ')).toContain(
        'Usage: bun node_modules/.bin/vulcan <scope> <action>',
      );
    }

    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
  });

  test('the help line of add lists every flag add takes, for each of its three kinds', () => {
    const help = runCli({ args: ['help'], cwd: tmpdir() }).stdout;
    const start = help.indexOf('  vulcan package add --preset');
    const block = help.slice(start, help.indexOf('  vulcan package diff ', start));

    for (const flag of [
      CreateFlags.PRESET,
      CreateFlags.APP,
      CreateFlags.LIB,
      CreateFlags.SHARED,
      CreateFlags.DIR,
      CreateFlags.SCOPE,
      CreateFlags.BACKEND_DIR,
      CreateFlags.FRONTEND_DIR,
      CreateFlags.API,
      CreateFlags.NO_API,
    ]) {
      expect(block, flag).toContain(flag);
    }

    expect(block).toContain('(--app <name> | --lib <name> | --shared <name>)');
    expect(block).toMatch(/\[--dir <folder>\]\s+\[--scope <@scope>\]/);
  });

  test('an argument a command does not take exits 1 naming it, and runs nothing', () => {
    const cwd = createProject({ files: { '.configs/vulcan.config.mts': 'export default {};\n' } });

    for (const args of [
      ['project', 'sync', '--dryrun'],
      ['project', 'sync', '--prune'],
      ['project', 'doctor', 'now'],
      ['project', 'init', '--force'],
      ['project', 'upgrade', 'a', 'b'],
    ]) {
      const result = runCli({ args, cwd });

      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stderr, args.join(' ')).toContain(
        `vulcan ${args[0]} ${args[1]}: unknown argument '${args.at(-1)}'`,
      );
      expect(result.stdout).toBe('');
    }

    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
  });

  test('one release train: cli, okf and atlas carry the same version', () => {
    expect(readVersion({ packageDirectory: 'okf' })).toBe(readVersion({ packageDirectory: 'cli' }));
    expect(readVersion({ packageDirectory: 'atlas' })).toBe(
      readVersion({ packageDirectory: 'cli' }),
    );
  });
});
