import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { alignmentSpec } from './alignment.fixture.ts';
import { BrowserPage } from './browser.helper.ts';

/**
 * A number tile with a state keeps its value off the state icon in the corner. The values are words, which are wider than a
 * number ("Hạng B", "Not ready yet"), measured in a real browser at 390, 768 and 1280 px, light and dark.
 *
 * It needs Chrome or Chromium; without one the measuring tests are skipped and the last test says so.
 */
const htmlOf = (): string => {
  const base = alignmentSpec() as { findings: Record<string, unknown> };
  const result = SpecPage.renderText({
    text: JSON.stringify({
      ...base,
      findings: {
        ...base.findings,
        numbers: [
          { value: 'Hạng B', label: 'sync', state: 'done' },
          { value: 'Chưa sẵn sàng', label: 'doctor', state: 'blocked' },
          { value: 'Supercalifragili', label: 'one long word', state: 'in progress' },
          { value: '83%', label: 'a number', state: 'done' },
        ],
      },
    }),
  });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

// The text of each value is measured as drawn (a range over its characters), against the icon of the same tile.
const MEASURE_TILES = `(() => {
  const clashes = [];
  const tiles = [...document.querySelectorAll('.tiles .tile')].filter((tile) => tile.getClientRects().length > 0);

  for (const tile of tiles) {
    const icon = tile.querySelector('.ic')?.getBoundingClientRect();
    const value = tile.querySelector('.n');
    const range = document.createRange();

    range.selectNodeContents(value);

    if (icon === undefined) {
      continue;
    }

    for (const box of range.getClientRects()) {
      if (box.left < icon.right && box.right > icon.left && box.top < icon.bottom && box.bottom > icon.top) {
        clashes.push(value.textContent);
      }
    }
  }

  return { tiles: tiles.length, clashes, scroll: document.documentElement.scrollWidth };
})()`;

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

describe.skipIf(!hasBrowser)(
  'a tile value stays off its state icon (measured in a browser)',
  () => {
    for (const width of [390, 768, 1280]) {
      for (const dark of [false, true]) {
        test(`${width} px, ${dark ? 'dark' : 'light'}: no value text under the icon, no sideways scroll`, async () => {
          const found = await BrowserPage.measure<{
            tiles: number;
            clashes: string[];
            scroll: number;
          }>({
            html: htmlOf(),
            width,
            dark,
            expression: MEASURE_TILES,
          });

          expect(found.tiles).toBeGreaterThanOrEqual(4);
          expect(found.clashes).toEqual([]);
          expect(found.scroll).toBeLessThanOrEqual(width);
        });
      }
    }
  },
);

describe.skipIf(hasBrowser)('no browser here', () => {
  test('the tile measuring was skipped: install Chrome or Chromium to run it', () => {
    console.warn(
      'visualize-tiles: no Chrome or Chromium could be started, the measuring was skipped',
    );
    expect(hasBrowser).toBe(false);
  });
});
