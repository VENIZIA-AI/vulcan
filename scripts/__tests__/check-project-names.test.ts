import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from './spawn.helper.ts';

const ROOT = join(import.meta.dir, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-project-names.ts');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const run = (opts: { root: string }) => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, SCRIPT, '--root', opts.root],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: result.exitCode, stderr: result.stderr.toString() };
};

const plant = (opts: { files: Record<string, string> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-names-'));

  roots.push(root);

  for (const [path, text] of Object.entries(opts.files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
};

test("VULCAN's own source names no project", () => {
  const result = run({ root: ROOT });

  expect(result.stderr).toBe('');
  expect(result.code).toBe(0);
});

test('a project name in src fails, naming the file and line; tests and fixtures may name them', () => {
  const root = plant({
    files: {
      'packages/okf/src/a.ts': 'export const a = 1;\n// the Ignis way\n',
      'packages/okf/src/__tests__/b.test.ts': "const name = '@venizia/ignis';\n",
      'packages/okf/src/__tests__/fixtures/c.ts': 'ARDOR\n',
    },
  });
  const result = run({ root });

  expect(result.code).toBe(1);
  expect(result.stderr).toContain('packages/okf/src/a.ts:2');
  expect(result.stderr).not.toContain('b.test.ts');
  expect(result.stderr).not.toContain('fixtures/c.ts');
});
