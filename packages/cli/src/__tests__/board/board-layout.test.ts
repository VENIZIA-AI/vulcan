import { afterAll, describe, expect, test } from 'bun:test';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

interface ILayout {
  innerWidth: number;
  scrollWidth: number;
  bodyScrollWidth: number;
  rowCount: number;
  /** For each column of a row, the left edge in pixels, one array per row. */
  columns: Record<string, number[]>;
  /** The right edge of the widest row cell, to see that nothing runs past the window. */
  rightmost: number;
  /** The flow codes that do not fit their cell. */
  codesTooWide: string[];
  detailScrollWidth: number;
  dockCells: number;
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

/** Runs in the page: opens every group, then reads where the cells of each row are and whether anything sticks out. */
const MEASURE = `(() => {
  for (const key of Object.keys(openGroups)) openGroups[key] = true;
  renderList();
  const rows = [...document.querySelectorAll('#groups .row')];
  const columns = {};
  let rightmost = 0;
  for (const row of rows) {
    for (const cell of row.children) {
      const box = cell.getBoundingClientRect();
      if (box.width === 0) continue;
      const name = cell.className.split(' ')[0] || cell.tagName.toLowerCase();
      (columns[name] ||= []).push(Math.round(box.left));
      rightmost = Math.max(rightmost, box.right);
    }
  }
  const codesTooWide = [...document.querySelectorAll('#groups .row .code')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent);
  select(FL[0].id, true);
  const detail = document.getElementById('detail');
  return JSON.stringify({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rowCount: rows.length,
    columns,
    rightmost: Math.round(rightmost),
    codesTooWide,
    detailScrollWidth: detail ? detail.scrollWidth - detail.clientWidth : 0,
    dockCells: document.querySelectorAll('#dock .cell').length,
    agentsListed: [...document.querySelectorAll('#dock .cell')].map((c) => c.dataset.agent),
    errors: window.__errs,
    title: document.title,
    heading: document.getElementById('boardTitle').textContent,
    headerText: document.querySelector('header.bar').innerText,
    bodyText: document.body.innerText,
    storageKeys: Object.keys(localStorage),
    logo: (document.querySelector('#mark img') || {}).src || null,
    ruleDisplay: getComputedStyle(document.querySelector('.brule')).display,
    holderOfFirst: (document.querySelector('#groups .row .holder') || {}).textContent || '',
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
      test(`${width}px, ${dark ? 'dark' : 'light'}: nothing sticks out sideways and the cells of the rows line up`, async () => {
        const raw = await BrowserPage.measure<string>({ html, width, dark, expression: MEASURE });
        const layout = JSON.parse(raw) as ILayout;

        expect(layout.innerWidth).toBe(width);
        expect(layout.scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width + 1);
        expect(layout.bodyScrollWidth, 'the body scrolls sideways').toBeLessThanOrEqual(width + 1);
        expect(layout.detailScrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(1);
        expect(layout.rightmost, 'a cell runs past the window').toBeLessThanOrEqual(width + 1);

        expect(layout.codesTooWide, 'a flow code runs into the title').toEqual([]);

        // Six flows: Needs you, three Running, Parked, Done, plus Unsorted.
        expect(layout.rowCount).toBe(6);

        // Every row puts the same column at the same left edge. The columns that exist depend on the width.
        const aligned = Object.entries(layout.columns).filter(([name]) =>
          ['code', 'tt', 'holder', 'age'].includes(name),
        );

        expect(aligned.map(([name]) => name)).toEqual(
          expect.arrayContaining(width > 700 ? ['code', 'tt', 'holder', 'age'] : ['tt', 'age']),
        );

        for (const [name, lefts] of aligned) {
          expect(lefts.length, name).toBe(layout.rowCount);
          expect(
            Math.max(...lefts) - Math.min(...lefts),
            `column ${name} is not aligned: ${lefts.join(', ')}`,
          ).toBeLessThanOrEqual(1);
        }

        // Neutral: the project's own name and owner, nothing of any organisation, and no script error.
        expect(layout.errors).toEqual([]);
        expect(layout.title).toBe('Acme Board');
        expect(layout.heading).toBe('Acme Board');
        expect(layout.holderOfFirst).toBe('Ana');
        expect(layout.headerText).not.toMatch(NOT_A_DEFAULT);
        expect(layout.storageKeys.every((key) => key.startsWith('board:acme:'))).toBe(true);
        expect(layout.logo).toBeNull();
        expect(layout.ruleDisplay, 'a rule stands where the logo would be').toBe('none');

        // The agents of the log are in the dock.
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
