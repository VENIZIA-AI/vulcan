import { expect, test } from 'bun:test';
import { styleRules } from '../../check/house.ts';
import { sanitizeProse } from '../../source/index.ts';

const flagged = (opts: { brand: string; text: string }): boolean =>
  styleRules({ brand: opts.brand }).some((rule) => rule.pattern.test(opts.text));

test('an all-caps brand flags its title-case spelling, never itself', () => {
  expect(flagged({ brand: 'ARDOR', text: 'Ardor ships a kernel' })).toBe(true);
  expect(flagged({ brand: 'ARDOR', text: 'ARDOR ships a kernel' })).toBe(false);
  expect(flagged({ brand: 'IGNIS', text: 'Ignis' })).toBe(true);
});

test('a brand that is not all caps adds no brand rule; the dash rule always holds', () => {
  expect(styleRules({ brand: 'Acme' }).length).toBe(1);
  expect(flagged({ brand: 'Acme', text: 'a - b' })).toBe(false);
  expect(flagged({ brand: 'Acme', text: 'a — b' })).toBe(true);
});

test('lifted prose takes the brand spelling and plain hyphens', () => {
  expect(sanitizeProse({ text: 'Ardor — the  kernel', brand: 'ARDOR' })).toBe('ARDOR - the kernel');
});
