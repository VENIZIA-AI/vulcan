import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '../../__tests__/spawn.helper.ts';

const PACKAGES = join(import.meta.dir, '..', '..', '..', 'packages');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Runs one test file with a private TMPDIR, so what it leaves behind is exactly what it created. */
const leftBehind = (opts: { pkg: string; file: string }): string[] => {
  const scratch = mkdtempSync(join(tmpdir(), 'tmp-hygiene-'));

  roots.push(scratch);

  const result = spawnSyncBounded({
    cmd: [process.execPath, 'test', opts.file],
    cwd: join(PACKAGES, opts.pkg),
    env: { ...process.env, TMPDIR: scratch },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  expect(result.exitCode).toBe(0);

  return readdirSync(scratch);
};

// A test run must leave /tmp as it found it: these files once left one directory per run.
describe('a test run leaves no temp directory behind', () => {
  for (const target of [
    { pkg: 'atlas', file: 'src/__tests__/common/project.test.ts' },
    { pkg: 'atlas', file: 'src/__tests__/common/project-config.test.ts' },
    { pkg: 'okf', file: 'src/__tests__/walk.test.ts' },
  ]) {
    test(`${target.pkg}: ${target.file}`, () => {
      expect(leftBehind(target)).toEqual([]);
    });
  }
});
