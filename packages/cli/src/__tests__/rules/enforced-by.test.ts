import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../../common/index.ts';
import { BaseRules } from '../../rules/index.ts';

const ROOT = join(import.meta.dir, '..', '..', '..', '..', '..');
const cellOf = (opts: { row: string }): string => opts.row.split('|').slice(-2, -1).join('').trim();
const CELLS = Object.entries(BaseRules.read({ packs: ['venizia'] })).map(
  ([id, row]) => [id, cellOf({ row })] as const,
);
const DOCS = readFileSync(join(ROOT, 'docs/wiki/content/references/rules.md'), 'utf8');

describe('the Enforced by column says what really enforces a rule', () => {
  test.each(CELLS)('%s opens with a mechanism the vocabulary defines', (_id, cell) => {
    expect(cell).toMatch(/^(HARD|SOFT|LINT|slot)\b/);
  });

  test.each(CELLS.filter(([, cell]) => cell.startsWith('HARD')))(
    '%s names only hooks that ship',
    (_id, cell) => {
      const hooks = [...cell.matchAll(/\bguard-[a-z]+\b/g)].map((match) => match[0]);

      expect(hooks.length).toBeGreaterThan(0);

      for (const hook of hooks) {
        expect(existsSync(join(BASE_DIRECTORY, 'hooks', `${hook}.ts`)), hook).toBe(true);
      }
    },
  );

  test('no cell leans on the session-start digest, which holds no rule text', () => {
    for (const [id, cell] of CELLS) {
      expect(cell, id).not.toMatch(/session[- ](start )?digest/i);
    }
  });

  test('the cells the review found wrong now say what holds', () => {
    const cell = Object.fromEntries(CELLS);

    expect(cell['V-B-08']).toMatch(/^HARD .*guard-outside.*SOFT for the rest$/);
    expect(cell['V-W-06']).toMatch(/^HARD .*guard-git.*SOFT for every other action/);
    expect(cell['V-S-01']).toContain('`vulcan doctor`');
    expect(cell['V-C-10']).toContain('consistent-type-assertions');
    expect(cell['V-C-06']).toContain('no-silent-catch');
    expect(cell['V-C-20']).toContain('no-await-new-chain');

    for (const id of ['V-P-07', 'V-P-08', 'V-B-07']) {
      expect(cell[id], id).toContain('the rules block of AGENTS.md');
    }
  });

  test('the rules page of the wiki gives each rule the same mechanism as the file it is copied from', () => {
    for (const [id, cell] of CELLS) {
      const lines = DOCS.split('\n');
      const start = lines.findIndex((line) => line.startsWith(`- \`${id}\` - `));
      const line = start < 0 ? undefined : lines[start + 1];
      const shown = line?.match(/^ {2}- Enforced by: (.*)$/)?.[1];

      expect(shown, id).toBeDefined();
      expect(shown?.split(/[\s(:,]/)[0], id).toBe(cell.split(/[\s(:,]/)[0]);
    }
  });
});
