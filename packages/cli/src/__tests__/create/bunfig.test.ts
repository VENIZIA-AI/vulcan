import { describe, expect, test } from 'bun:test';
import { oxfmtConfigs } from '@venizia/dev-configs/formatters';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBunfig } from '../../create/bunfig.ts';

describe('renderBunfig', () => {
  test('is a comment line, telemetry = false and the [fmt] section bun fmt reads', () => {
    expect(renderBunfig()).toBe(
      [
        '# Bun reads this file only from the directory a command runs in, so it sits at the root.',
        'telemetry = false',
        '',
        '[fmt]',
        'printWidth = 100',
        'singleQuote = true',
        'arrowParens = "avoid"',
        '',
      ].join('\n'),
    );
  });

  test('carries the settings of @venizia/dev-configs oxfmtConfigs, so bun fmt and oxfmt agree', () => {
    const lines = renderBunfig().split('\n');

    expect(lines).toContain(`printWidth = ${oxfmtConfigs.printWidth}`);
    expect(lines).toContain(`singleQuote = ${oxfmtConfigs.singleQuote}`);
    expect(lines).toContain(`arrowParens = "${oxfmtConfigs.arrowParens}"`);
  });
});

describe("the VULCAN repository's own bunfig.toml", () => {
  test('is the file init writes', () => {
    const root = join(import.meta.dir, '..', '..', '..', '..', '..');

    expect(readFileSync(join(root, 'bunfig.toml'), 'utf8')).toBe(renderBunfig());
  });
});
