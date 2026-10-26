import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBunfig } from '../../create/bunfig.ts';

describe('renderBunfig', () => {
  test('is a comment line, telemetry = false and the [fmt] section bun fmt reads, the oxfmt flavor included', () => {
    expect(renderBunfig()).toBe(
      [
        '# Bun reads this file from the directory a command runs in, and bun fmt also inherits it from a parent.',
        '# So it sits at the root, and [fmt] applies to every folder below it.',
        'telemetry = false',
        '',
        '[fmt]',
        'printWidth = 100',
        'singleQuote = true',
        'arrowParens = "always"',
        'flavor = "oxfmt"',
        '',
      ].join('\n'),
    );
  });
});

describe("the VULCAN repository's own bunfig.toml", () => {
  // What init writes, then the one section only this repository has: its bare `bun test` keeps temp folders in the repo.
  test('is the file init writes, plus the test preload', () => {
    const root = join(import.meta.dir, '..', '..', '..', '..', '..');

    expect(readFileSync(join(root, 'bunfig.toml'), 'utf8')).toBe(
      `${renderBunfig()}\n[test]\npreload = ["./scripts/test/repo-tmp.preload.ts"]\n`,
    );
  });
});
