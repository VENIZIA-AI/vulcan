import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS = join(import.meta.dir, '..', '..', '..', '.github', 'workflows');
const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml'));
const lines = files.flatMap((name) =>
  readFileSync(join(WORKFLOWS, name), 'utf8')
    .split('\n')
    .map((text, index) => ({ name, line: index + 1, text })),
);

describe('the workflows pin what they run', () => {
  test('every action of another repository is pinned to a commit, with its version in a comment', () => {
    const unpinned = lines
      .filter((entry) => /^\s*(?:-\s+)?uses:\s+[^.\s][^\s@]*@/.test(entry.text))
      .filter((entry) => !/@[0-9a-f]{40}\s+#\s*v\d/.test(entry.text))
      .map((entry) => `${entry.name}:${entry.line} ${entry.text.trim()}`);

    expect(unpinned).toEqual([]);
  });

  test('bun is a fixed version in every workflow, never latest', () => {
    const floating = lines
      .filter((entry) => /bun-version:\s*(?:latest|canary|\^|~|>)/.test(entry.text))
      .map((entry) => `${entry.name}:${entry.line}`);

    expect(floating).toEqual([]);
  });
});
