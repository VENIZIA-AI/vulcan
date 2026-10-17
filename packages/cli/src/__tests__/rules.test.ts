import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { parseRuleIds, readSlots } from '../rules/index.ts';

describe('parseRuleIds', () => {
  test('reads plain and bold ID cells in table order and skips the header', () => {
    const markdown = '| ID | Rule |\n|---|---|\n| W-01 | a |\n| **P-09** | b |\n| text | c |\n';

    expect(parseRuleIds({ markdown })).toEqual(['W-01', 'P-09']);
  });

  test('reads namespaced base IDs next to bare project IDs', () => {
    const markdown = '| V-W-01 | a |\n| **V-C-04** | b |\n| W-06 | c |\n';

    expect(parseRuleIds({ markdown })).toEqual(['V-W-01', 'V-C-04', 'W-06']);
  });

  test('the shipped base: W5 S7 P6 B4 + the C group C-01..C-18', () => {
    const ids = parseRuleIds({ markdown: readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8') });

    expect(ids).toHaveLength(40);
    expect(ids.every(id => id.startsWith('V-'))).toBe(true);
    expect(ids).toContain('V-W-01');
    expect(ids.filter(id => id.startsWith('V-C-'))).toHaveLength(18);
    expect(new Set(ids).size).toBe(ids.length);
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
  const cited = [...prose.matchAll(/(?<![A-Z]-)\b(?:V-)?[WSPBC]-\d{2}\b/g)].map(match => match[0]);

  expect(cited.filter(id => !ids.has(id))).toEqual([]);
});
