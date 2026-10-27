import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  findRepositoryRoot,
  REPO_TMP_DIRECTORY,
  spawnSyncBounded,
} from '@venizia/dev-configs/testing';

const REPO_ROOT = findRepositoryRoot(import.meta.dir);
const TEST_TMP = join(REPO_ROOT, REPO_TMP_DIRECTORY);

const PACKAGES = join(REPO_ROOT, 'packages');
const SYSTEM_TEMP = '/tmp';
/** What a VULCAN test or smoke names its temp folders; one of these new in the system temp is a leak. */
const LEAK_PATTERN = /^(vulcan-|tmp-hygiene-|atlas-|skill-eval-|preset-|ignore\.\d+$)/;
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A new folder next to the test folder, so it counts as "the system temp" to the run under test. */
const makeFakeSystemTemp = (): string => {
  const parent = join(REPO_ROOT, '.agents', 'local', 'tmp');
  const root = mkdtempSync(join(parent, 'hygiene-system-'));

  roots.push(root);

  return root;
};

/** A private folder inside the test folder: a run keeps it as its TMPDIR, so what is left in it is exactly what it made. */
const makePrivateTestTemp = (): string => {
  mkdirSync(join(TEST_TMP, '.git'), { recursive: true });

  const root = mkdtempSync(join(TEST_TMP, 'hygiene-private-'));

  roots.push(root);

  return root;
};

const systemTempLeaks = (): string[] =>
  existsSync(SYSTEM_TEMP) ? readdirSync(SYSTEM_TEMP).filter((name) => LEAK_PATTERN.test(name)) : [];

/** Runs one test file with a bare `bun test` (no make) and the given TMPDIR; its exit code must be 0. */
const runBare = (opts: { pkg: string; file: string; tmpdir: string }): void => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, 'test', opts.file],
    cwd: join(PACKAGES, opts.pkg),
    env: { ...process.env, TMPDIR: opts.tmpdir },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  expect(result.exitCode).toBe(0);
};

const TARGETS = [
  { pkg: 'atlas', file: 'src/__tests__/common/project.test.ts' },
  { pkg: 'atlas', file: 'src/__tests__/common/project-config.test.ts' },
  // The files that make their directories through sources/source-repo.helper.ts.
  { pkg: 'atlas', file: 'src/__tests__/sources/refs.test.ts' },
  { pkg: 'atlas', file: 'src/__tests__/sources/installed.test.ts' },
  { pkg: 'atlas', file: 'src/__tests__/server/skills.test.ts' },
  { pkg: 'okf', file: 'src/__tests__/walk.test.ts' },
  // createProject, hermeticEnv and a spawned hook.
  { pkg: 'cli', file: 'src/__tests__/sync/prune.test.ts' },
  { pkg: 'cli', file: 'src/__tests__/local/clean.test.ts' },
  { pkg: 'cli', file: 'src/__tests__/hooks/trusted-scripts.test.ts' },
];

// A test run must leave the system temp as it found it, make or no make: an agent that runs one file
// with a bare `bun test` has no TMPDIR from make, and a killed run once left a folder per run in /tmp.
describe('a test run keeps its temp folders out of the system temp', () => {
  for (const target of TARGETS) {
    test(`${target.pkg}: ${target.file}`, () => {
      const system = makeFakeSystemTemp();
      const leaksBefore = new Set(systemTempLeaks());

      runBare({ ...target, tmpdir: system });

      expect(readdirSync(system)).toEqual([]);
      expect(systemTempLeaks().filter((name) => !leaksBefore.has(name))).toEqual([]);
    });
  }
});

describe('a test run leaves no temp folder behind', () => {
  for (const target of TARGETS) {
    test(`${target.pkg}: ${target.file}`, () => {
      const scratch = makePrivateTestTemp();

      runBare({ ...target, tmpdir: scratch });

      expect(readdirSync(scratch)).toEqual([]);
    });
  }
});
