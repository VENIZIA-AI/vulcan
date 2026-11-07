import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { alignmentSpec } from './alignment.fixture.ts';
import { BrowserPage } from './browser.helper.ts';

/**
 * The top bar stays inside the screen. Measured in a real browser at 390, 600 and 860 px with a long title: the page does not
 * scroll sideways and the controls (present, the theme switch) end inside the viewport; the title is what gives way.
 *
 * Its links are whole or absent: a link never shows cut, the buttons keep one line, and the title of the page keeps enough
 * space between lines for the Vietnamese marks (a line height of 1.14 or more, 1.24 or more on a phone).
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

// Links that show are whole inside the link area; a link on a hidden row is not counted. Buttons stay on one line.
const MEASURE_NAV = `(() => {
  const area = document.querySelector('.top .links');
  const areaBox = area.getBoundingClientRect();
  const links = [...area.querySelectorAll('a')];
  const shown = links.filter((a) => { const box = a.getBoundingClientRect(); return areaBox.width > 0 && box.top >= areaBox.top - 1 && box.bottom <= areaBox.bottom + 1; });
  const cut = shown.filter((a) => { const box = a.getBoundingClientRect(); return box.left < areaBox.left - 1 || box.right > areaBox.right + 1; }).map((a) => a.textContent);
  const partly = links.filter((a) => { const box = a.getBoundingClientRect(); const inside = box.top >= areaBox.top - 1 && box.bottom <= areaBox.bottom + 1; const outside = box.top >= areaBox.bottom - 1 || box.bottom <= areaBox.top + 1; return areaBox.width > 0 && !inside && !outside; }).map((a) => a.textContent);
  const buttons = [...document.querySelectorAll('.top .btn')].filter((b) => b.getClientRects().length > 0).map((b) => Math.round(b.getBoundingClientRect().height));
  const heading = getComputedStyle(document.querySelector('.hero h1'));

  return { total: links.length, shown: shown.length, cut, partly, buttons, ratio: parseFloat(heading.lineHeight) / parseFloat(heading.fontSize), scroll: document.documentElement.scrollWidth };
})()`;

interface INavFound {
  total: number;
  shown: number;
  cut: string[];
  partly: string[];
  buttons: number[];
  ratio: number;
  scroll: number;
}

const navHtml = (opts: { language?: string }): string => {
  const result = SpecPage.renderText({
    text: JSON.stringify({ ...alignmentSpec(), language: opts.language, asOf: '2026-11-07' }),
  });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

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

describe.skipIf(!hasBrowser)('the top bar links and the page title (measured in a browser)', () => {
  for (const language of ['en', 'vi']) {
    for (const width of [390, 768, 861, 1024, 1280, 1440]) {
      for (const dark of [false, true]) {
        test(`${width} px, ${language}, ${dark ? 'dark' : 'light'}: links whole or hidden, buttons on one line, title line height`, async () => {
          const found = await BrowserPage.measure<INavFound>({
            html: navHtml({ language }),
            width,
            dark,
            expression: MEASURE_NAV,
          });

          expect(found.cut).toEqual([]);
          expect(found.partly).toEqual([]);
          expect(found.scroll).toBeLessThanOrEqual(width);

          for (const height of found.buttons) {
            expect(height).toBeLessThanOrEqual(36);
          }

          expect(found.ratio).toBeGreaterThanOrEqual(width <= 860 ? 1.24 : 1.14);

          // Wide enough for the nav: at least one link shows, and a phone shows none (the bar keeps the title and the switch).
          if (width <= 860) {
            expect(found.shown).toBe(0);
          } else {
            expect(found.shown).toBeGreaterThan(0);
          }
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
