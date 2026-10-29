import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('the project rules name the base of a pull request', () => {
  const rule = read('.agents/rules.md')
    .split('\n')
    .filter((line) => line.startsWith('| **W-01**'))
    .join('\n');

  test('W-01 gives the commands a person copies: --base develop for a feature, --base main for the Sync', () => {
    expect(rule).toContain('gh pr create --base develop');
    expect(rule).toContain('gh pr create --base main');
  });

  test('CONTRIBUTING gives the same command for a feature', () => {
    expect(read('CONTRIBUTING.md')).toContain('gh pr create --base develop');
  });

  test('no rule or guide tells a feature pull request to close its issue with its own body', () => {
    for (const text of [rule, read('CONTRIBUTING.md')]) {
      expect(text).not.toMatch(/body says `Closes #N`/);
    }
  });
});
