import { expect, test } from 'bun:test';
import { HouseCheck } from '../../check/house.ts';
import { SourceCollector } from '../../source/index.ts';

const flagged = (opts: { brand: string; text: string }): boolean =>
  HouseCheck.styleRules({ brand: opts.brand }).some((rule) => rule.pattern.test(opts.text));

test('an all-caps brand flags its title-case spelling, never itself', () => {
  expect(flagged({ brand: 'ARDOR', text: 'Ardor ships a kernel' })).toBe(true);
  expect(flagged({ brand: 'ARDOR', text: 'ARDOR ships a kernel' })).toBe(false);
  expect(flagged({ brand: 'IGNIS', text: 'Ignis' })).toBe(true);
});

test('a brand that is not all caps adds no brand rule; the dash rule always holds', () => {
  expect(HouseCheck.styleRules({ brand: 'Acme' }).length).toBe(1);
  expect(flagged({ brand: 'Acme', text: 'a - b' })).toBe(false);
  expect(flagged({ brand: 'Acme', text: 'a — b' })).toBe(true);
});

test('lifted prose takes the brand spelling and plain hyphens', () => {
  expect(SourceCollector.sanitizeProse({ text: 'Ardor — the  kernel', brand: 'ARDOR' })).toBe(
    'ARDOR - the kernel',
  );
});
