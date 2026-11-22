import { afterAll, describe, expect, test } from 'bun:test';
import { BrowserPage } from './browser.helper.ts';
import { renderSpec } from './render.helper.ts';

/**
 * The top bar holds only the theme switch, and the head of the page holds the title, one sentence and the contents
 * line. Measured in a real browser: the page never scrolls sideways, whatever the title; the title is 28 px with room
 * for the Vietnamese marks; the contents line is one row at 1280 px and one link per row at 390 px.
 *
 * It needs Chrome or Chromium; without one the measuring tests are skipped and the last test says so.
 */
const TITLES = {
  'a title of many words': 'A very long report title that goes on and on about the state of it',
  'a title in one unbroken word': `Supercalifragilistic${'x'.repeat(40)}`,
};

const WIDTHS = [390, 600, 860, 1280];

const specOf = (opts: { title: string; language?: string }): Record<string, unknown> => ({
  schemaVersion: 1,
  title: opts.title.slice(0, 60),
  language: opts.language,
  status: { state: 'warn' },
  asOf: '2026-11-07',
  scope: 'the page of the test',
  verdict: 'One sentence the reader can stop at.',
  strip: { next: 'Choose one.' },
  decisions: [
    {
      question: 'Which one?',
      options: [
        { label: 'First', effect: 'It is quick.', recommended: true },
        { label: 'Second', effect: 'It is slow.' },
      ],
      why: 'Quick is enough.',
    },
  ],
  minimap: [
    { task: 'Read it', status: 'done' },
    { task: 'Choose', status: 'waiting' },
  ],
  evidence: [{ claim: 'It holds', probe: 'a test', result: 'passes', label: 'verified' }],
});

const htmlOf = (opts: { title: string; language?: string }): string => {
  const result = renderSpec(specOf(opts));

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

const MEASURE = `(() => {
  const heading = getComputedStyle(document.querySelector('.head h1'));
  const links = [...document.querySelectorAll('.toc a')];
  const tops = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
  const theme = document.querySelector('.top #theme').getBoundingClientRect();

  return {
    scroll: document.documentElement.scrollWidth,
    themeRight: Math.round(theme.right),
    links: links.length,
    rows: tops.size,
    size: parseFloat(heading.fontSize),
    ratio: parseFloat(heading.lineHeight) / parseFloat(heading.fontSize),
    column: Math.round(document.querySelector('.head .wrap').getBoundingClientRect().width),
  };
})()`;

interface IFound {
  scroll: number;
  themeRight: number;
  links: number;
  rows: number;
  size: number;
  ratio: number;
  column: number;
}

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

describe.skipIf(!hasBrowser)('the head and the contents line (measured in a browser)', () => {
  for (const [name, title] of Object.entries(TITLES)) {
    for (const width of WIDTHS) {
      for (const dark of [false, true]) {
        test(`${width} px, ${name}, ${dark ? 'dark' : 'light'}: no sideways scroll, the switch on screen, a 28 px title`, async () => {
          const found = await BrowserPage.measure<IFound>({
            html: htmlOf({ title }),
            width,
            dark,
            expression: MEASURE,
          });

          expect(found.scroll).toBeLessThanOrEqual(width);
          expect(found.themeRight).toBeLessThanOrEqual(width);
          expect(found.size).toBe(28);
          expect(found.ratio).toBeGreaterThanOrEqual(1.14);
          expect(found.column).toBeLessThanOrEqual(960);
        });
      }
    }
  }

  for (const language of ['en', 'vi']) {
    test(`${language}: the contents line is one row at 1280 px and one link per row at 390 px`, async () => {
      const wide = await BrowserPage.measure<IFound>({
        html: htmlOf({ title: 'A plain title', language }),
        width: 1280,
        dark: false,
        expression: MEASURE,
      });
      const narrow = await BrowserPage.measure<IFound>({
        html: htmlOf({ title: 'A plain title', language }),
        width: 390,
        dark: false,
        expression: MEASURE,
      });

      expect(wide.links).toBe(4);
      expect(wide.rows).toBe(1);
      expect(narrow.rows).toBe(narrow.links);
    });
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
