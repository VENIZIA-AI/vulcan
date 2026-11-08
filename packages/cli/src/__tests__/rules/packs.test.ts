import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../../common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { BaseRules, RulePacks, RuleParser } from '../../rules/index.ts';

const MOVED = ['V-B-05', 'V-B-09', 'V-C-07', 'V-C-08', 'V-C-20'];

describe('RulePacks', () => {
  test('the venizia pack is shipped and holds the five rules that left the base, with their IDs', () => {
    expect(RulePacks.names()).toEqual(['venizia']);
    expect(Object.keys(RulePacks.rowsOf({ name: 'venizia' }))).toEqual(MOVED);
    expect(RulePacks.rowsOf({ name: 'venizia' })['V-C-08']).toContain('TConstValue');
  });

  test('a name that is no shipped pack has no rows', () => {
    expect(RulePacks.rowsOf({ name: 'nonsense' })).toEqual({});
    expect(RulePacks.rowsOf({ name: '../rules' })).toEqual({});
  });

  test('which pack holds a rule: a moved rule, and none for a base rule or an unknown one', () => {
    expect(RulePacks.holderOf({ id: 'V-C-20' })).toBe('venizia');
    expect(RulePacks.holderOf({ id: 'V-C-02' })).toBeUndefined();
    expect(RulePacks.holderOf({ id: 'V-Z-99' })).toBeUndefined();
  });

  test('the pack file is named from the project root, under node_modules', () => {
    expect(RulePacks.pathOf({ name: 'venizia' })).toBe(
      'node_modules/@venizia/vulcan/base/packs/venizia.md',
    );
  });
});

describe('BaseRules.read with packs', () => {
  test('the base alone has none of the moved rules; the venizia pack adds them back', () => {
    const base = BaseRules.read();
    const withPack = BaseRules.read({ packs: ['venizia'] });

    for (const id of MOVED) {
      expect(base[id], id).toBeUndefined();
      expect(withPack[id], id).toStartWith(`| ${id} |`);
    }

    expect(Object.keys(withPack)).toHaveLength(Object.keys(base).length + MOVED.length);
  });

  test('a rule ID is in the base or in a pack, never in both', () => {
    const base = Object.keys(BaseRules.read());

    for (const id of Object.keys(RulePacks.rowsOf({ name: 'venizia' }))) {
      expect(base, id).not.toContain(id);
    }
  });

  test('the moved rules are listed, as bullets and not as rows, at the end of the base rules', () => {
    const text = readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');
    const tail = text.slice(text.indexOf('## Moved to a rule pack'));

    for (const id of MOVED) {
      expect(tail, id).toContain(`- \`${id}\``);
    }

    expect(RuleParser.parseIds({ markdown: tail })).toEqual([]);
  });
});

describe('the packs key of the config', () => {
  test('is empty by default and takes a shipped pack', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).packs).toEqual([]);
    expect(VULCAN_CONFIG_SCHEMA.parse({ packs: ['venizia'] }).packs).toEqual(['venizia']);
  });

  test('refuses a pack VULCAN does not ship, and names the ones it does', () => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ packs: ['nonsense'] });

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.message).toContain(
      'a rule pack VULCAN ships: venizia',
    );
  });
});
