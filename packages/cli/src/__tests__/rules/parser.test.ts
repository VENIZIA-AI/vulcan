import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../../common/index.ts';
import {
  extractRuleRows,
  parseBaseReferences,
  parseRetiredRuleIds,
  parseRuleIds,
  readBaseRules,
  readRetiredRuleIds,
  readSlots,
} from '../../rules/index.ts';

describe('parseRuleIds', () => {
  test('reads plain and bold ID cells in table order and skips the header', () => {
    const markdown = '| ID | Rule |\n|---|---|\n| W-01 | a |\n| **P-09** | b |\n| text | c |\n';

    expect(parseRuleIds({ markdown })).toEqual(['W-01', 'P-09']);
  });

  test('reads namespaced base IDs next to bare project IDs', () => {
    const markdown = '| V-W-01 | a |\n| **V-C-04** | b |\n| W-06 | c |\n';

    expect(parseRuleIds({ markdown })).toEqual(['V-W-01', 'V-C-04', 'W-06']);
  });

  test('the shipped base: W5 S7 P12 B9 + the C group, 50 rules, every ID unique', () => {
    const ids = parseRuleIds({ markdown: readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8') });

    expect(ids).toHaveLength(50);
    expect(ids.every((id) => id.startsWith('V-'))).toBe(true);
    expect(ids).toContain('V-W-01');
    expect(ids.filter((id) => id.startsWith('V-C-'))).toHaveLength(17);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('retired IDs are gone from the tables and named as retired, never reused', () => {
    const markdown = readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');
    const ids = parseRuleIds({ markdown });

    for (const retired of ['V-W-05', 'V-C-03', 'V-C-05']) {
      expect(ids).not.toContain(retired);
      expect(markdown).toContain(`${retired}`);
    }
  });

  test('V-C-02: one options object first, at most 5 parameters, enforced by the house lint', () => {
    const rows = extractRuleRows({
      markdown: readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8'),
    });
    const row = rows.find((line) => line.includes('| V-C-02 |')) ?? '';

    expect(row).toContain('One options object first, at most 5 parameters');
    expect(row).toContain('isValidName({ name })');
    expect(row).toContain('venizia/max-params-own');
    expect(row).toContain('72 call sites');
  });

  test('V-C-18 binds no stack; V-P-02 is design the surface first', () => {
    const rows = extractRuleRows({
      markdown: readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8'),
    });
    const rowOf = (opts: { id: string }): string =>
      rows.find((row) => row.includes(`| ${opts.id} |`)) ?? '';

    expect(rowOf({ id: 'V-C-18' })).not.toMatch(/Drizzle|Hono|PostgreSQL|SQLite/);
    expect(rowOf({ id: 'V-C-18' })).toMatch(/derived types over duplicates/i);
    expect(rowOf({ id: 'V-P-02' })).toContain('surface');
    expect(rowOf({ id: 'V-P-02' })).not.toContain('gate: planned');
  });
});

describe('parseBaseReferences', () => {
  test('reads Extends lists in rule rows and every V- ID in a first cell, once each, in order', () => {
    const markdown = [
      '| **W-00** | **Extends V-W-01 (slot).** mine | SOFT |',
      '| **S-01** | **Extends V-S-01 and V-S-07.** mine | SOFT |',
      '| **P-01** | Extends V-P-01, V-P-04 and V-W-01. mine | SOFT |',
      '| V-W-02, V-W-03 | the guard asks | Asks |',
      '| **V-C-04** | quoted | SOFT |',
    ].join('\n');

    expect(parseBaseReferences({ markdown })).toEqual([
      'V-W-01',
      'V-S-01',
      'V-S-07',
      'V-P-01',
      'V-P-04',
      'V-W-02',
      'V-W-03',
      'V-C-04',
    ]);
  });

  test('a V- ID in prose or in a later cell is not a reference', () => {
    const markdown =
      'Extends V-Z-99 in prose.\n| ID | Rule |\n|---|---|\n| W-06 | like V-Z-98 | V-Z-97 |\n';

    expect(parseBaseReferences({ markdown })).toEqual([]);
  });
});

describe('readBaseRules', () => {
  test('every base rule ID maps to its row', () => {
    const rules = readBaseRules();

    expect(Object.keys(rules)).toHaveLength(50);
    expect(rules['V-W-02']).toStartWith('| V-W-02 | Never write to a database.');
  });

  test('the agent-work rules are present, each with its own key phrase', () => {
    const rules = readBaseRules();
    const phrases: Record<string, string> = {
      'V-W-06': 'Approval has a card',
      'V-P-08': 'does it need to exist at all?',
      'V-P-09': 'Work card and done report',
      'V-P-10': 'Ask once, with a recommendation',
      'V-P-11': 'answer first',
      'V-P-12': 'Delegate by kind',
      'V-B-06': 'Small never cuts safety',
      'V-B-07': '// SHORTCUT: <what>, <why>, <revisit when>',
      'V-B-08': 'Leave no trace',
      'V-B-09': 'bun by default',
      'V-C-19': 'Group options that serve one concern',
    };

    for (const [id, phrase] of Object.entries(phrases)) {
      expect(rules[id] ?? '').toContain(phrase);
    }
  });

  test('V-C-11 says small is not golfed', () => {
    expect(readBaseRules()['V-C-11'] ?? '').toContain('not golfed');
  });

  test('V-B-05 states the seven app scripts, the legacy names and where the logic lives', () => {
    const row = readBaseRules()['V-B-05'] ?? '';

    for (const name of [
      'server:dev',
      'compile',
      'typecheck',
      'lint',
      'lint:fix',
      'test',
      'clean',
    ]) {
      expect(row).toContain(`\`${name}\``);
    }

    for (const legacy of ['dev', 'start', 'build', 'rebuild', 'preview', 'server:prod']) {
      expect(row).toContain(`\`${legacy}\``);
    }

    expect(row).toContain('`devz lint`');
    expect(row).toContain('`devz lint --fix`');
    expect(row).toContain('`devz clean`');
    expect(row).toContain('bun .configs/builders/compile.ts');
    expect(row).toContain('vite build --config .configs/builders/vite.config.mts');
    expect(row).toContain('NODE_ENV=development bun run src/index.ts');
    expect(row).not.toContain('scripts/');
  });

  test('V-B-05 also says what an app root holds and where every other config lives', () => {
    const row = readBaseRules()['V-B-05'] ?? '';

    expect(row).toContain(
      'An app root holds only `.configs/`, `src/`, `package.json`, `tsconfig.json` and `.env.example`',
    );
    expect(row).not.toContain('components.json');
    expect(row).toContain('`.configs/{lints,formatters,builders}/`');
  });
});

describe('readRetiredRuleIds', () => {
  test('the base lists V-W-05, V-C-03 and V-C-05 as retired', () => {
    expect(readRetiredRuleIds()).toEqual(['V-W-05', 'V-C-03', 'V-C-05']);
  });

  test('reads one ID per "- `V-X-NN` - why" bullet, nothing else', () => {
    const markdown = '- `V-W-05` - gone\n- `V-C-03` - moved\n- see `V-C-04`\n| V-W-01 | live |\n';

    expect(parseRetiredRuleIds({ markdown })).toEqual(['V-W-05', 'V-C-03']);
  });
});

describe('readSlots', () => {
  test('V-W-01 offers on-user-word and read-only; only read-only carries settings', () => {
    const slots = readSlots();

    expect(Object.keys(slots)).toEqual(['V-W-01']);
    expect(Object.keys(slots['V-W-01'].options).sort()).toEqual(['on-user-word', 'read-only']);
    expect(slots['V-W-01'].options['read-only'].settings).toBeDefined();
    expect(slots['V-W-01'].options['on-user-word'].settings).toBeUndefined();
  });
});

test('every rule ID cited inside the base rules exists in the base, with its V- prefix', () => {
  const markdown = readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');
  const ids = new Set(parseRuleIds({ markdown }));
  // Inline code holds examples of a project's bare IDs (`W-06`), never citations.
  const prose = markdown.replace(/`[^`]*`/g, '');
  const cited = [...prose.matchAll(/(?<![A-Z]-)\b(?:V-)?[WSPBC]-\d{2}\b/g)].map(
    (match) => match[0],
  );

  expect(cited.filter((id) => !ids.has(id))).toEqual([]);
});
