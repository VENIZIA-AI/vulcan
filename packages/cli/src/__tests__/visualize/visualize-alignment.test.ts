import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { GROUPS, MEASURE } from './alignment.groups.ts';
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
