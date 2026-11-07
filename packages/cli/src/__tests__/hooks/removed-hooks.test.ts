import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const OLD_ENTRY = readFileSync(
  join(import.meta.dir, '..', 'fixtures', 'old-blocking-hook-entry.txt'),
  'utf8',
);

// Each test starts a shell and a bun process.
setDefaultTimeout(60_000);

/** Blocking hooks that were removed. A project that has not run `vulcan sync` since still registers each one. */
const REMOVED_BLOCKING = ['guard-package', 'guard-remote-hosts', 'guard-manifest'];

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

describe('an entry an older vulcan sync wrote for a removed hook', () => {
  for (const hook of REMOVED_BLOCKING) {
    test(`${hook}: the call passes against this package, and the hook says nothing`, () => {
      const root = projectWithThisPackage();
      const result = spawnSyncBounded({
        cmd: ['/bin/sh', '-c', OLD_ENTRY.split('@@HOOK@@').join(hook)],
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: new Blob([
          JSON.stringify({
            ['tool_name']: 'Write',
            ['tool_input']: { ['file_path']: 'x' },
            cwd: root,
          }),
        ]),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe('');
      expect(result.stderr.toString()).toBe('');
    });
  }
});
