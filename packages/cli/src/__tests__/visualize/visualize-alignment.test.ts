import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { alignmentSpec } from './alignment.fixture.ts';
import { BrowserPage } from './browser.helper.ts';

/**
 * Repeated cards share their rows. Measured in a real browser, on a page built to break alignment (a badge on one
 * card only, a label that wraps, a title of three lines, lists of different length): for every repeated structure, the
 * same part of every card in one visual row has the same top, at 1280 and at 390 px, in light and in dark. A CSS review
 * cannot see a wrapped label shift a row; this can.
 *
 * It needs Chrome or Chromium. Without one the measuring tests are skipped and the last test says so; set
 * VULCAN_BROWSER_TMPDIR to a short folder when the browser says its socket path is too long.
 */
interface IGroup {
  name: string;
  /** The container; its items are laid out side by side (mode `rows`) or one under another (mode `column`). */
  container: string;
  item: string;
  slots: string[];
  mode?: 'rows' | 'column';
}

const upTo = (opts: { count: number; make: (index: number) => string }): string[] =>
  Array.from({ length: opts.count }, (_unused, index) => opts.make(index + 1));

const GROUPS: IGroup[] = [
  {
    name: 'comparison cards',
    container: '#comparison .opts',
    item: '.opt',
    slots: [
      '.tag-slot',
      '.tot',
      'h3',
      '.ln',
      '.crit',
      ...upTo({ count: 8, make: (n) => `.crit > div:nth-child(${n})` }),
      '.proslist',
      ...upTo({ count: 6, make: (n) => `.proslist li:nth-child(${n})` }),
      '.conslist',
      ...upTo({ count: 6, make: (n) => `.conslist li:nth-child(${n})` }),
    ],
  },
  {
    name: 'decision record options',
    container: '#decision-record .opts',
    item: '.opt',
    slots: ['.tag-slot', 'h3', '.ln'],
  },
  { name: 'tiles', container: '.tiles', item: '.tile', slots: ['.n', '.l'] },
  {
    name: 'minimap stepper',
    container: '.strip',
    item: '.seg',
    slots: ['.bar', '.nm', '.tn', '.nt'],
  },
  { name: 'the owner cards', container: '.own', item: ':scope > div', slots: ['.lab'] },
  { name: 'the two facts', container: '.facts', item: '.fact', slots: ['b'] },
  { name: 'charts', container: '.charts', item: 'figure.chart', slots: ['.lab', '.cbody', '.tv'] },
  {
    name: 'before and after',
    container: '.diff',
    item: '.ba',
    slots: ['h3', 'ul', 'li:nth-child(1)', 'li:nth-child(2)'],
  },
  { name: 'idea map branches', container: '.idea', item: '.branch', slots: ['h3', '.chips'] },
  {
    name: 'flow steps',
    container: '.steps',
    item: ':scope > li',
    slots: ['button b', 'button span'],
  },
  { name: 'terms', container: '.terms', item: ':scope > div', slots: ['dt', 'dd'] },
  { name: 'links', container: '.links', item: ':scope > li', slots: ['a'] },
  { name: 'decisions', container: '.qs', item: '.q', slots: ['h3', '.rec'], mode: 'column' },
  {
    name: 'timeline',
    container: '.tl',
    item: ':scope > li',
    slots: ['time', 'h3'],
    mode: 'column',
  },
  {
    name: 'evidence',
    container: '.ledger',
    item: '.ev',
    slots: ['.badge', 'b', '.rs'],
    mode: 'column',
  },
  { name: 'log', container: '.log', item: ':scope > li', slots: ['time'], mode: 'column' },
];

/** The measuring code run in the page: for each group, the spread (in px) of each slot across the items of one visual row (or one column). */
const MEASURE = `((groups) => {
  const found = [];
  const round = (value) => Math.round(value * 10) / 10;

  for (const group of groups) {
    for (const container of document.querySelectorAll(group.container)) {
      const items = [...container.querySelectorAll(group.item)];
      const bands = [];

      if (group.mode === 'column') {
        bands.push({ items });
      } else {
        for (const item of items) {
          const top = item.getBoundingClientRect().top;
          let band = bands.find((entry) => Math.abs(entry.top - top) < 2);

          if (band === undefined) {
            band = { top, items: [] };
            bands.push(band);
          }

          band.items.push(item);
        }
      }

      for (const band of bands) {
        if (band.items.length < 2) {
          continue;
        }

        if (group.mode !== 'column') {
          const bottoms = band.items.map((item) => item.getBoundingClientRect().bottom);

          if (Math.max(...bottoms) - Math.min(...bottoms) > 1) {
            found.push({ group: group.name, slot: '(the card itself: its bottom)', spread: round(Math.max(...bottoms) - Math.min(...bottoms)) });
          }
        }

        for (const slot of group.slots) {
          const values = band.items
            .map((item) => item.querySelector(slot))
            .filter((element) => element !== null)
            .map((element) => round(group.mode === 'column' ? element.getBoundingClientRect().left : element.getBoundingClientRect().top));

          if (values.length < 2) {
            continue;
          }

          const spread = Math.max(...values) - Math.min(...values);

          if (spread > 1) {
            found.push({ group: group.name, slot, spread: round(spread), values });
          }
        }
      }
    }
  }

  return found;
})(`;

const html = ((): string => {
  const result = SpecPage.renderText({ text: JSON.stringify(alignmentSpec()) });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
})();

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

describe.skipIf(!hasBrowser)('repeated cards share their rows (measured in a browser)', () => {
  for (const width of [1280, 390]) {
    for (const dark of [false, true]) {
      test(`${width} px, ${dark ? 'dark' : 'light'}: the same part of every card has the same top`, async () => {
        const found = await BrowserPage.measure<unknown[]>({
          html,
          width,
          dark,
          expression: `${MEASURE}${JSON.stringify(GROUPS)})`,
        });

        expect(found).toEqual([]);
      });
    }
  }

  test('390 px: nothing makes the page scroll sideways', async () => {
    const overflow = await BrowserPage.measure<number>({
      html,
      width: 390,
      dark: false,
      expression: 'document.documentElement.scrollWidth - window.innerWidth',
    });

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the measuring would catch a shifted card: a badge pushed into one card moves its score', async () => {
    // The check itself is checked: the same page with the badge slot taken out of the recommended card must fail.
    const broken = html
      .replace(/<span class="tag-slot"[^>]*>(?:<span class="tag">[^<]*<\/span>)?<\/span>/g, '')
      .replace(
        /<article class="opt rec( sp\d+)">/,
        '<article class="opt rec$1"><span class="tag">x</span>',
      );
    const found = await BrowserPage.measure<{ group: string }[]>({
      html: broken,
      width: 1280,
      dark: false,
      expression: `${MEASURE}${JSON.stringify(GROUPS)})`,
    });

    expect(found.some((entry) => entry.group === 'comparison cards')).toBe(true);
  });
});

describe.skipIf(hasBrowser)('no browser here', () => {
  test('the alignment measuring was skipped: install Chrome or Chromium to run it', () => {
    console.warn(
      'visualize-alignment: no Chrome or Chromium could be started, the layout measuring was skipped',
    );
    expect(hasBrowser).toBe(false);
  });
});
