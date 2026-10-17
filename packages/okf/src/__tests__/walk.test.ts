import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { walkFiles } from '../source/index.ts';

test('the source walk skips __tests__: a test fixture is never counted as source', () => {
  const root = mkdtempSync(join(tmpdir(), 'okf-walk-'));

  mkdirSync(join(root, 'src', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'src', 'service.ts'), 'export class RealService {}\n');
  writeFileSync(join(root, 'src', '__tests__', 'fake.ts'), 'export class FakeService {}\n');

  expect(walkFiles({ dir: root }).map(file => relative(root, file))).toEqual([
    join('src', 'service.ts'),
  ]);
});

test('the walk is sorted, so generated output never depends on the file system order', () => {
  const root = mkdtempSync(join(tmpdir(), 'okf-walk-'));

  for (const name of ['zeta.ts', 'alpha.ts', 'mid.ts', 'beta.ts']) {
    writeFileSync(join(root, name), '\n');
  }

  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'nested', 'a.ts'), '\n');

  expect(walkFiles({ dir: root }).map(file => relative(root, file))).toEqual([
    'alpha.ts',
    'beta.ts',
    'mid.ts',
    join('nested', 'a.ts'),
    'zeta.ts',
  ]);
});
