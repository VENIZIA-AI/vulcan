import { afterAll, describe, expect, test } from 'bun:test';
import type { IBoardData } from '../../board/common/index.ts';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

interface IDock {
  cards: { agent: string; text: string }[];
  count: string;
  countAfterToggle: string;
  errors: string[];
}

/** Runs in the page: the cards of the agents pane, then the count after "Show all events" is pressed; it is pressed back, because the browser keeps the choice between tests. */
const MEASURE_DOCK = `(async () => {
  const cards = () => [...document.querySelectorAll('#dock [data-agent]')];
  const result = {
    cards: cards().map((c) => ({ agent: c.dataset.agent, text: c.innerText })),
    count: document.querySelector('#dock .c-n').textContent,
    errors: window.__errs,
  };
  document.getElementById('bPlumb').click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  result.countAfterToggle = document.querySelector('#dock .c-n').textContent;
  document.getElementById('bPlumb').click();
  return JSON.stringify(result);
})()`;

const withErrors = (page: string): string =>
  page.replace(
    '<script type="application/json"',
    '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
  );

const dataWith = (opts: Partial<IBoardData>): IBoardData => ({
  ...sampleData({ base: Date.now() - 100 * 60_000 }),
  ...opts,
});

const measure = async (data: IBoardData): Promise<IDock> => {
  const raw = await BrowserPage.measure<string>({
    html: withErrors(BoardPage.render({ data })),
    width: 1440,
    dark: false,
    expression: MEASURE_DOCK,
  });

  return JSON.parse(raw) as IDock;
};

const ALL = ['pnt-ardor-1', 'pnt-ignis-1', 'pnt-vulcan-1', 'veni-forge'];

describe.skipIf(!hasBrowser)('the agents pane with a roster and lanes, in a real browser', () => {
  test('no roster: every agent of the log has a card, by name', async () => {
    const dock = await measure(dataWith({}));

    expect(dock.cards.map((card) => card.agent)).toEqual(ALL);
    expect(dock.count).toBe('4');
    expect(dock.errors).toEqual([]);
  });

  test('a roster hides nobody: it only puts the listed agents first', async () => {
    const dock = await measure(dataWith({ roster: ['veni-forge', 'pnt-vulcan-1'] }));

    expect(dock.cards.map((card) => card.agent)).toEqual([
      'veni-forge',
      'pnt-vulcan-1',
      'pnt-ardor-1',
      'pnt-ignis-1',
    ]);
    expect(dock.count).toBe('4');
    expect(dock.countAfterToggle).toBe('4');
    expect(dock.errors).toEqual([]);
  });

  test('a lane hides nobody either: the helper keeps its card and says whom it works under', async () => {
    const dock = await measure(
      dataWith({
        roster: ['veni-forge', 'pnt-vulcan-1'],
        lanes: { 'pnt-ignis-1': 'pnt-vulcan-1', 'pnt-ardor-1': 'veni-forge' },
      }),
    );
    const byAgent = Object.fromEntries(dock.cards.map((card) => [card.agent, card.text]));

    expect(Object.keys(byAgent).sort()).toEqual(ALL);
    expect(byAgent['pnt-ignis-1']).toContain('under pnt-vulcan-1');
    expect(byAgent['pnt-ardor-1']).toContain('under veni-forge');
    expect(byAgent['pnt-vulcan-1']).not.toContain('under');
    expect(dock.count).toBe('4');
    expect(dock.errors).toEqual([]);
  });

  test('a flow held by a helper shows the helper as its holder, and its lines keep the helper name', async () => {
    const data = dataWith({ lanes: { 'pnt-ignis-1': 'pnt-vulcan-1' } });
    const raw = await BrowserPage.measure<string>({
      html: withErrors(BoardPage.render({ data })),
      width: 1440,
      dark: false,
      expression: `(async () => {
        const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
        document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
        await wait();
        const holders = [...document.querySelectorAll('#groups .row .c-chips .h')].map((node) => node.textContent.replace(/ holds$/, ''));
        document.querySelector('#groups .row').click();
        await wait();
        document.querySelector('.d-all').click();
        await wait();
        const who = [...document.querySelectorAll('#dBody .evs .who b:first-child')].map((b) => b.textContent);
        return JSON.stringify({ holders, who, errors: window.__errs });
      })()`,
    });
    const seen: { holders: string[]; who: string[]; errors: string[] } = JSON.parse(raw);

    expect(seen.holders).toContain('pnt-ignis-1');
    expect(seen.errors).toEqual([]);
  });
});
