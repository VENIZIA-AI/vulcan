import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const OLD_OPEN_ENTRY = readFileSync(
  join(import.meta.dir, '..', 'fixtures', 'old-open-hook-entry.txt'),
  'utf8',
);

// Each test starts a shell and a bun process.
setDefaultTimeout(60_000);

/** Fail-open hooks that were removed, with no file kept: an old entry passes by itself when its file is missing. */
const REMOVED_OPEN = ['stop', 'prompt-submit', 'post-tool'];

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A project whose installed package is this one, as `bun install` leaves it. */
const projectWithThisPackage = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-removed-hooks-'));

  roots.push(root);
  mkdirSync(join(root, 'node_modules', '@venizia'), { recursive: true });
  symlinkSync(PACKAGE_ROOT, join(root, 'node_modules', '@venizia', 'vulcan'));

  return root;
};

describe('an entry an older vulcan sync wrote for a removed fail-open hook', () => {
  for (const hook of REMOVED_OPEN) {
    test(`${hook}: with its file gone, the old entry still passes the call`, () => {
      const root = projectWithThisPackage();
      const result = spawnSyncBounded({
        cmd: ['/bin/sh', '-c', OLD_OPEN_ENTRY.split('@@HOOK@@').join(hook)],
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: new Blob(['{}']),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(0);
    });
  }
});
