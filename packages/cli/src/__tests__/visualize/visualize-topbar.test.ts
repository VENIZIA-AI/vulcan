import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { alignmentSpec } from './alignment.fixture.ts';
import { BrowserPage } from './browser.helper.ts';

/**
 * The top bar stays inside the screen. Measured in a real browser at 390 px with a long title: the page does not
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

// The width asked of the browser, not `window.innerWidth`: a phone widens its layout viewport to fit what overflows.
const VIEWPORT = 390;

const MEASURE_BAR = `(() => {
  const edge = (selector) => { const box = document.querySelector(selector)?.getBoundingClientRect(); return box ? Math.round(box.right) : null; };
  return {
    scroll: document.documentElement.scrollWidth,
    theme: edge('.top #theme'),
    nav: edge('.top nav'),
    title: edge('.top .ttl'),
  };
})()`;

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

describe.skipIf(!hasBrowser)('the top bar stays inside 390 px (measured in a browser)', () => {
  for (const [name, title] of Object.entries(TITLES)) {
    for (const dark of [false, true]) {
      test(`${name}, ${dark ? 'dark' : 'light'}: no sideways scroll, the theme switch is on screen`, async () => {
        const found = await BrowserPage.measure<{ scroll: number; theme: number; nav: number }>({
          html: htmlOf({ title }),
          width: VIEWPORT,
          dark,
          expression: MEASURE_BAR,
        });

        expect(found.scroll).toBeLessThanOrEqual(VIEWPORT);
        expect(found.theme).toBeLessThanOrEqual(VIEWPORT);
        expect(found.nav).toBeLessThanOrEqual(VIEWPORT);
      });
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
