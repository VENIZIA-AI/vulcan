import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('the project rules name the base of a pull request (default branch main)', () => {
  const rule = read('.agents/rules.md')
    .split('\n')
    .filter((line) => line.startsWith('| **W-01**'))
    .join('\n');

  test('W-01 opens a feature with --base develop and the Sync with --base main, and never leaves the base out', () => {
    expect(rule).toContain('gh pr create --base develop');
    expect(rule).toContain('gh pr create --base main');
    expect(rule).toContain('never with the base left out');
  });

  test('W-01 closes issues at the Sync, not in a feature pull request', () => {
    expect(rule).toContain('`Refs #N`');
    expect(rule).toContain('lists `Closes #N`');
  });

  test('CONTRIBUTING gives the same command and the same issue rule', () => {
    const contributing = read('CONTRIBUTING.md');

    expect(contributing).toContain('gh pr create --base develop');
    expect(contributing).toContain('`Refs #N`');
  });
});
