import { describe, expect, test } from 'bun:test';
import { DEFAULT_CHROME } from '../../visualize/constants.ts';
import { BUNDLED_LANGUAGES, Labels } from '../../visualize/labels.ts';
import { VI_CHROME } from '../../visualize/labels-vi.ts';
import { VISUALIZE_SCHEMA } from '../../visualize/schema.ts';
import type { TVisualizeSpec } from '../../visualize/schema.ts';
import { fullSpec } from './spec.fixture.ts';

const specWith = (chrome?: Record<string, unknown>): TVisualizeSpec =>
  VISUALIZE_SCHEMA.parse({ ...fullSpec(), ...(chrome === undefined ? {} : { chrome }) });

const tupleOf = (opts: { path: string; value: unknown }): [string, unknown] => [
  opts.path,
  opts.value,
];

/** Every string of a word set with its dotted path, nested sets included. */
const flatten = (opts: { value: Record<string, unknown>; prefix?: string }): [string, unknown][] =>
  Object.entries(opts.value).flatMap(([key, value]) => {
    const path = `${opts.prefix ?? ''}${key}`;

    return typeof value === 'object' && value !== null
      ? flatten({ value: Object.fromEntries(Object.entries(value)), prefix: `${path}.` })
      : [tupleOf({ path, value })];
  });

const english = flatten({ value: DEFAULT_CHROME });
const vietnamese = new Map(flatten({ value: VI_CHROME }));

/** Words that are the same in both languages on purpose: none today. */
const SAME_IN_BOTH = new Set<string>([]);

describe('the bundled words: which set a language gets (C4)', () => {
  test('en, en-GB and a language with no bundled set get the English words', () => {
    for (const language of ['en', 'en-GB', 'EN', 'fr', 'fr-FR', 'xx', '', undefined]) {
      expect(Labels.chromeOf({ spec: specWith(), language })).toEqual(DEFAULT_CHROME);
    }
  });

  test('vi, vi-VN, VI and vi_VN get the Vietnamese words', () => {
    for (const language of ['vi', 'vi-VN', 'VI', 'Vi-vn', 'vi_VN', ' vi ']) {
      expect(Labels.chromeOf({ spec: specWith(), language })).toEqual(VI_CHROME);
    }
  });

  test('the bundled languages are English and Vietnamese', () => {
    expect(Object.keys(BUNDLED_LANGUAGES).sort()).toEqual(['en', 'vi']);
    expect(BUNDLED_LANGUAGES.en).toBe(DEFAULT_CHROME);
    expect(BUNDLED_LANGUAGES.vi).toBe(VI_CHROME);
  });

  test('a key of the prototype is not a language', () => {
    expect(Labels.chromeOf({ spec: specWith(), language: 'constructor' })).toEqual(DEFAULT_CHROME);
    expect(Labels.chromeOf({ spec: specWith(), language: 'toString' })).toEqual(DEFAULT_CHROME);
  });
});

describe('the spec overrides sit on top of the bundled words', () => {
  test('an override replaces one Vietnamese word and keeps the others', () => {
    const chrome = Labels.chromeOf({ spec: specWith({ status: 'Tình trạng' }), language: 'vi' });

    expect(chrome.status).toBe('Tình trạng');
    expect(chrome.scope).toBe(VI_CHROME.scope);
  });

  test('an override of a nested word keeps its siblings, in Vietnamese and in English', () => {
    const vi = Labels.chromeOf({ spec: specWith({ statusStates: { ok: 'Tốt' } }), language: 'vi' });
    const en = Labels.chromeOf({
      spec: specWith({ statusStates: { ok: 'Fine' } }),
      language: 'en',
    });

    expect(vi.statusStates).toEqual({ ...VI_CHROME.statusStates, ok: 'Tốt' });
    expect(en.statusStates).toEqual({ ...DEFAULT_CHROME.statusStates, ok: 'Fine' });

    const minimap = Labels.chromeOf({
      spec: specWith({ minimapStates: { done: 'hoàn tất' }, evidenceLabels: { guess: 'ước' } }),
      language: 'vi',
    });

    expect(minimap.minimapStates).toEqual({ ...VI_CHROME.minimapStates, done: 'hoàn tất' });
    expect(minimap.evidenceLabels).toEqual({ ...VI_CHROME.evidenceLabels, guess: 'ước' });
  });

  test('the spec language does not matter to chromeOf: the caller passes the resolved one', () => {
    expect(Labels.chromeOf({ spec: specWith({ status: 'X' }) }).status).toBe('X');
    expect(Labels.chromeOf({ spec: specWith() }).status).toBe(DEFAULT_CHROME.status);
  });
});

describe('the Vietnamese words: complete and clean (S5)', () => {
  test('every key of the English set, nested ones included, is in Vietnamese', () => {
    const missing = english.map(([path]) => path).filter((path) => !vietnamese.has(path));

    expect(missing).toEqual([]);
    expect(vietnamese.size).toBe(english.length);
  });

  test('the nested sets have the same keys as English', () => {
    for (const set of ['statusStates', 'minimapStates', 'evidenceLabels'] as const) {
      expect(Object.keys(VI_CHROME[set]).sort()).toEqual(Object.keys(DEFAULT_CHROME[set]).sort());
    }
  });

  test('no value is empty or blank', () => {
    for (const [path, value] of vietnamese) {
      expect(typeof value, path).toBe('string');
      expect(String(value).trim().length, path).toBeGreaterThan(0);
    }
  });

  test('a Vietnamese word differs from the English one, except the justified few', () => {
    const same = english
      .filter(([path, value]) => vietnamese.get(path) === value)
      .map(([path]) => path);

    expect(same.filter((path) => !SAME_IN_BOTH.has(path))).toEqual([]);
  });

  test('no value has an em dash, an en dash or markup characters', () => {
    for (const [path, value] of vietnamese) {
      expect(String(value), path).not.toMatch(/[–—<>&]/);
    }
  });

  test('the page words are neutral: they never say anh or em', () => {
    for (const [path, value] of vietnamese) {
      expect(String(value), path).not.toMatch(/(^|\s)(anh|em)(\s|$|[.,;:?!])/i);
    }
  });

  test('a button word stays about as short as the English one', () => {
    for (const [path, value] of vietnamese) {
      const limit = Math.max(24, String(english.find(([key]) => key === path)?.[1]).length * 2);

      expect(String(value).length, path).toBeLessThanOrEqual(limit);
    }
  });

  test('the Vietnamese words have diacritics where Vietnamese has them', () => {
    const marked = [...vietnamese.values()].filter((value) => /[À-ỹ]/.test(String(value)));

    expect(marked.length).toBeGreaterThan(english.length / 2);
  });
});
