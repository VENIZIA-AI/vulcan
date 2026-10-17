import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '../spawn.helper';

const PROJECT_MODULE = join(__dirname, '..', '..', 'common', 'project.ts');

test('the project root is the working directory, never an IGNIS_ROOT left in the environment', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-root-')));
  const child = spawnSyncBounded({
    cmd: [
      process.execPath,
      '-e',
      `const m = await import(${JSON.stringify(PROJECT_MODULE)}); console.log(m.PROJECT_ROOT);`,
    ],
    cwd,
    env: { ...process.env, IGNIS_ROOT: '/somewhere/else' },
    stdout: 'pipe',
  });

  expect(child.stdout.toString().trim()).toBe(cwd);
});
