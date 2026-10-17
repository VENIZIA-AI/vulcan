import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from './spawn.helper.ts';

const CONFIG_MODULE = join(import.meta.dir, '..', 'config.ts');

test('okf reads the working directory, never an IGNIS_ROOT left in the environment', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'okf-root-')));
  const child = spawnSyncBounded({
    cmd: [
      process.execPath,
      '-e',
      `const m = await import(${JSON.stringify(CONFIG_MODULE)}); console.log(m.REPO);`,
    ],
    cwd,
    env: { ...process.env, IGNIS_ROOT: '/somewhere/else' },
    stdout: 'pipe',
  });

  expect(child.stdout.toString().trim()).toBe(cwd);
});
