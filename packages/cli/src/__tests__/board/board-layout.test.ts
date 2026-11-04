import { afterAll, describe, expect, test } from 'bun:test';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

interface ILayout {
  innerWidth: number;
  scrollWidth: number;
  bodyScrollWidth: number;
  rowCount: number;
  /** The left and right edge of each flow card, in pixels. */
  lefts: number[];
  rights: number[];
  detailScrollWidth: number;
  agentsListed: string[];
  errors: string[];
  title: string;
  heading: string;
  headerText: string;
  bodyText: string;
  storageKeys: string[];
  logo: string | null;
  ruleDisplay: string;
  holderOfFirst: string;
}

/** Words of one organisation or of the old host: none may be in what the page itself says. */
const NOT_A_DEFAULT = /venizia|\bphát\b|ignis|ardor|claude|đồng bộ/i;

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

/** Runs in the page: opens every group, then reads where the cards are and whether anything sticks out. */
const MEASURE = `(async () => {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
  await wait();
  const rows = [...document.querySelectorAll('#groups .row')];
  const box = (node) => node.getBoundingClientRect();
  const lefts = rows.map((row) => Math.round(box(row).left));
  const rights = rows.map((row) => Math.round(box(row).right));
  document.querySelector('#groups .row').click();
  await wait();
  const detail = document.getElementById('detail');
  return JSON.stringify({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rowCount: rows.length,
    lefts,
    rights,
    detailScrollWidth: detail ? detail.scrollWidth - detail.clientWidth : 0,
    agentsListed: [...document.querySelectorAll('#dock [data-agent]')].map((c) => c.dataset.agent),
    errors: window.__errs,
    title: document.title,
    heading: document.getElementById('boardTitle').textContent,
    headerText: document.querySelector('header.bar').innerText,
    bodyText: document.body.innerText,
    storageKeys: Object.keys(localStorage),
    logo: (document.querySelector('#mark img') || {}).src || null,
    ruleDisplay: getComputedStyle(document.querySelector('.brule')).display,
    holderOfFirst: ((document.querySelector('#groups .row .c-chips .h') || {}).textContent || '').replace(/ holds$/, ''),
  });
})()`;

/** Runs in the page: the text of an empty board, then the same after a switch to Vietnamese. */
const MEASURE_EMPTY = `(() => {
  const en = document.body.innerText;
  document.getElementById('bLang').click();
  return JSON.stringify({ en, vi: document.body.innerText, errors: window.__errs });
})()`;

describe.skipIf(!hasBrowser)('the board page in a real browser', () => {
  // The lines are placed in the last two hours, so the day's merged flow is in the Done group whenever this runs.
  const LOGO = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>').toString('base64')}`;
  // An error handler first, so a script that throws is seen; the page itself is the one the command writes.
  const withErrors = (page: string): string =>
    page
      .replace('<!--', '<!--')
      .replace(
        '<script type="application/json"',
        '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
      );
  const html = withErrors(
    BoardPage.render({ data: sampleData({ base: Date.now() - 100 * 60_000 }) }),
  );
  const withLogo = withErrors(
    BoardPage.render({ data: { ...sampleData({ base: Date.now() - 100 * 60_000 }), logo: LOGO } }),
  );

  for (const width of [1440, 390]) {
    for (const dark of [false, true]) {
      test(`${width}px, ${dark ? 'dark' : 'light'}: nothing sticks out sideways and the cards line up`, async () => {
        const raw = await BrowserPage.measure<string>({ html, width, dark, expression: MEASURE });
        const layout = JSON.parse(raw) as ILayout;

        expect(layout.innerWidth).toBe(width);
        expect(layout.scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width + 1);
        expect(layout.bodyScrollWidth, 'the body scrolls sideways').toBeLessThanOrEqual(width + 1);
        expect(layout.detailScrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(1);
        expect(Math.max(...layout.rights), 'a card runs past the window').toBeLessThanOrEqual(
          width + 1,
        );

        // Five flows: Needs you, three Running, Parked, Done. The lines with no flow are not a card.
        expect(layout.rowCount).toBe(5);

        // The cards of one column line up: the same left and right edge.
        expect(
          Math.max(...layout.lefts) - Math.min(...layout.lefts),
          'the cards are not aligned',
        ).toBeLessThanOrEqual(1);
        expect(
          Math.max(...layout.rights) - Math.min(...layout.rights),
          'the cards differ in width',
        ).toBeLessThanOrEqual(1);

        // Neutral: the project's own name and owner, nothing of any organisation, and no script error.
        expect(layout.errors).toEqual([]);
        expect(layout.title).toBe('Acme Board');
        expect(layout.heading).toBe('Acme Board');
        expect(layout.holderOfFirst).toBe('Ana');
        expect(layout.headerText).not.toMatch(NOT_A_DEFAULT);
        expect(layout.storageKeys.every((key) => key.startsWith('board:acme:'))).toBe(true);
        expect(layout.logo).toBeNull();
        expect(layout.ruleDisplay, 'a rule stands where the logo would be').toBe('none');

        // The agents of the log are in the agents pane.
        expect(layout.agentsListed.sort()).toEqual([
          'pnt-ardor-1',
          'pnt-ignis-1',
          'pnt-vulcan-1',
          'veni-forge',
        ]);
      });
    }
  }

  test('a logo from the config is shown as an image and takes no script with it', async () => {
    const raw = await BrowserPage.measure<string>({
      html: withLogo,
      width: 1440,
      dark: false,
      expression: MEASURE,
    });
    const layout = JSON.parse(raw) as ILayout;

    expect(layout.logo).toBe(LOGO);
    expect(layout.ruleDisplay).not.toBe('none');
    expect(layout.errors).toEqual([]);
    expect(layout.scrollWidth).toBeLessThanOrEqual(1441);
  });

  test('an empty board says only generic things, in English and in Vietnamese', async () => {
    const empty = withErrors(
      BoardPage.render({ data: { ...sampleData(), flows: [], agents: {}, decisions: {} } }),
    );
    const raw = await BrowserPage.measure<string>({
      html: empty,
      width: 1440,
      dark: false,
      expression: MEASURE_EMPTY,
    });
    const result = JSON.parse(raw) as { en: string; vi: string; errors: string[] };

    expect(result.errors).toEqual([]);
    expect(result.en).toContain(
      'No flows yet. Turn on events.log, or write a line with vulcan event add.',
    );
    expect(result.en).not.toMatch(NOT_A_DEFAULT);
    expect(result.vi).toContain('events.log');
    expect(result.vi).not.toMatch(NOT_A_DEFAULT);
  });
});
