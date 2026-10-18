import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_FILE } from '@/common/project-config';
import { spawnSyncBounded } from '../spawn.helper';

const CLI = join(__dirname, '..', '..', 'cli.ts');

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }

  tempDirectories.length = 0;
});

const makeTempDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-help-'));

  tempDirectories.push(directory);

  return directory;
};

/** A project atlas can serve: a manifest and an empty knowledge bundle. */
const makeProject = (): string => {
  const root = makeTempDirectory();

  mkdirSync(join(root, '.agents/knowledge'), { recursive: true });
  writeFileSync(join(root, MANIFEST_FILE), JSON.stringify({ schemaVersion: 1, name: 'demo' }));

  return root;
};

const run = (opts: { args: string[]; cwd: string }) => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, CLI, ...opts.args],
    cwd: opts.cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe('help', () => {
  test.each(['--help', '-h', 'help'])('%s prints the usage on stdout and exits 0', flag => {
    const result = run({ args: [flag], cwd: makeTempDirectory() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('usage: vulcan-atlas');
    expect(result.stdout).toContain('tools');
  });
});

describe('tools', () => {
  test('lists every tool the server offers, one line each, without an MCP client', () => {
    const result = run({ args: ['tools', '--root', makeProject()], cwd: makeTempDirectory() });
    const names = result.stdout
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.split(/\s+/)[0]);

    expect(result.code).toBe(0);
    expect(names).toEqual(['search', 'get', 'symbol', 'version', 'changes']);
  });

  test('outside a project it fails with the usage, not silently', () => {
    const result = run({ args: ['tools'], cwd: makeTempDirectory() });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('nothing to serve');
  });
});
