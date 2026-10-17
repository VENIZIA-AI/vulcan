import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';
import { spawnSyncBounded } from './spawn.helper.ts';

const ROOT = join(import.meta.dir, '..', '..');

// A source folder named like build output (`coverage/`, `dist/`, `build/`) is silently dropped by
// .gitignore: it works locally and is missing from every commit - and from CI.
test('no source file is ignored by git', () => {
  const files = [
    ...new Glob('packages/*/{src,base,scripts}/**/*').scanSync({ cwd: ROOT, onlyFiles: true }),
    ...new Glob('scripts/**/*').scanSync({ cwd: ROOT, onlyFiles: true }),
  ].filter(file => !file.includes('/node_modules/'));
  const result = spawnSyncBounded({
    cmd: ['git', 'check-ignore', '--stdin'],
    cwd: ROOT,
    stdin: new TextEncoder().encode(files.join('\n')),
  });

  expect(files.length).toBeGreaterThan(100);
  expect(result.stdout.toString().split('\n').filter(Boolean)).toEqual([]);
});
