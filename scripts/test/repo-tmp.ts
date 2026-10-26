/**
 * Where a test or a smoke makes its temp folders: `.agents/local/tmp/tests` of this checkout, never
 * the system temp (V-B-08). `make test` and `make smoke-*` set TMPDIR to it (make/test.mk); this does
 * the same for a run without make - a bare `bun test` on one file, `bun scripts/build/pack-smoke-*.ts`
 * - and is the one place that knows the path.
 *
 * The empty `.git` marker in it stops git and bun's ignore lookup from reading this repository (see
 * make/test.mk), so GIT_CEILING_DIRECTORIES is set to the same folder.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dir, '..', '..');
export const TEST_TMP = join(REPO_ROOT, '.agents', 'local', 'tmp', 'tests');

type TSpawn = (...args: any[]) => unknown;

/**
 * `Bun.spawn` and `Bun.spawnSync` hand a child the environment the process started with, not the one
 * it has now, so a TMPDIR set here would never reach it. Wrapped to default to the current one; an
 * `env` a caller passes wins. `spawn(cmd, options)` and `spawn({ cmd, ...options })` are both handled.
 */
const withCurrentEnv = (spawn: TSpawn): TSpawn => {
  return (...args) => {
    const [first, second] = args;
    const options = Array.isArray(first) ? second : first;

    if (options?.env !== undefined) {
      return spawn(...args);
    }

    return Array.isArray(first)
      ? spawn(first, { ...second, env: process.env })
      : spawn({ ...first, env: process.env });
  };
};

/**
 * Points TMPDIR at the repository's test folder unless it is already inside it (make's value, or a
 * private folder a caller made there), and returns the folder now in force. Idempotent.
 */
export const useRepoTmp = (): string => {
  const current = process.env.TMPDIR;

  if (current !== undefined && `${resolve(current)}${sep}`.startsWith(`${TEST_TMP}${sep}`)) {
    return current;
  }

  mkdirSync(join(TEST_TMP, '.git'), { recursive: true });
  process.env.TMPDIR = TEST_TMP;
  process.env.GIT_CEILING_DIRECTORIES = TEST_TMP;
  Bun.spawn = withCurrentEnv(Bun.spawn) as typeof Bun.spawn;
  Bun.spawnSync = withCurrentEnv(Bun.spawnSync) as typeof Bun.spawnSync;

  return TEST_TMP;
};
