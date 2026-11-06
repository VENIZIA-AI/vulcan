import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { alignmentSpec } from './alignment.fixture.ts';
import { BrowserPage } from './browser.helper.ts';

/**
 * The top bar stays inside the screen. Measured in a real browser at 390, 600 and 860 px with a long title: the page does not
 * scroll sideways and the controls (present, the theme switch) end inside the viewport; the title is what gives way.
 *
 * It needs Chrome or Chromium; without one the measuring tests are skipped and the last test says so.
 */
const TITLES = {
  'a long title of many words':
    'A very long report title that goes on and on about the state of the whole project today',
  'a long title in one unbroken word': `Supercalifragilistic${'x'.repeat(80)}`,
};

const htmlOf = (opts: { title: string }): string => {
  const result = SpecPage.renderText({
    text: JSON.stringify({ ...alignmentSpec(), title: opts.title }),
  });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

// The widths asked of the browser, not `window.innerWidth`: a phone widens its layout viewport to fit what overflows.
// 390 is a phone; 600 and 860 are the band where the present button is shown next to the switch.
const WIDTHS = [390, 600, 860];

const MEASURE_BAR = `(() => {
  const edge = (selector) => { const box = document.querySelector(selector)?.getBoundingClientRect(); return box ? Math.round(box.right) : null; };
  return {
    scroll: document.documentElement.scrollWidth,
    theme: edge('.top #theme'),
    nav: edge('.top nav'),
    present: edge('.top #present'),
  };
})()`;

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

describe.skipIf(!hasBrowser)('the top bar stays inside the screen (measured in a browser)', () => {
  for (const [name, title] of Object.entries(TITLES)) {
    for (const width of WIDTHS) {
      for (const dark of [false, true]) {
        test(`${width} px, ${name}, ${dark ? 'dark' : 'light'}: no sideways scroll, the switch and present are on screen`, async () => {
          const found = await BrowserPage.measure<{
            scroll: number;
            theme: number;
            nav: number;
            present: number | null;
          }>({ html: htmlOf({ title }), width, dark, expression: MEASURE_BAR });

          expect(found.scroll).toBeLessThanOrEqual(width);
          expect(found.theme).toBeLessThanOrEqual(width);
          expect(found.nav).toBeLessThanOrEqual(width);
          expect(found.present ?? 0).toBeLessThanOrEqual(width);
        });
      }
    }
  }
});

describe.skipIf(hasBrowser)('no browser here', () => {
  test('the top bar measuring was skipped: install Chrome or Chromium to run it', () => {
    console.warn(
      'visualize-topbar: no Chrome or Chromium could be started, the measuring was skipped',
    );
    expect(hasBrowser).toBe(false);
  });
});
