import { afterAll, describe, expect, test } from 'bun:test';
import type { IBoardData } from '../../board/common/index.ts';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

interface IDock {
  before: { agent: string; text: string }[];
  count: string;
  afterToggle: string[];
  countAfterToggle: string;
  errors: string[];
}

/** Runs in the page: the cells of the dock, then the same after "Show all events" is pressed; it is pressed back, because the browser keeps the choice between tests. */
const MEASURE_DOCK = `(async () => {
  const cells = () => [...document.querySelectorAll('#dock .cell')];
  const before = cells().map((c) => ({ agent: c.dataset.agent, text: c.innerText }));
  const count = document.getElementById('dockN').textContent;
  document.getElementById('bPlumb').click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const result = {
    before,
    count,
    afterToggle: cells().map((c) => c.dataset.agent),
    countAfterToggle: document.getElementById('dockN').textContent,
    errors: window.__errs,
  };
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
  const dock: IDock = JSON.parse(raw);

  return dock;
};

describe.skipIf(!hasBrowser)('the board page with a roster and lanes, in a real browser', () => {
  test('no roster: every agent of the log shows, as before', async () => {
    const dock = await measure(dataWith({}));

    expect(dock.before.map((cell) => cell.agent).sort()).toEqual([
      'pnt-ardor-1',
      'pnt-ignis-1',
      'pnt-vulcan-1',
      'veni-forge',
    ]);
    expect(dock.errors).toEqual([]);
  });

  test('a roster shows only the listed agents, and "Show all events" shows the rest', async () => {
    const dock = await measure(dataWith({ roster: ['veni-forge', 'pnt-vulcan-1'] }));

    expect(dock.before.map((cell) => cell.agent).sort()).toEqual(['pnt-vulcan-1', 'veni-forge']);
    expect(dock.count).toBe('2 agents');
    expect(dock.afterToggle.sort()).toEqual([
      'pnt-ardor-1',
      'pnt-ignis-1',
      'pnt-vulcan-1',
      'veni-forge',
    ]);
    expect(dock.countAfterToggle).toBe('4 agents');
    expect(dock.errors).toEqual([]);
  });

  test('a helper rolls into its lane: no row of its own, and the lane says how many helpers', async () => {
    const dock = await measure(
      dataWith({
        roster: ['veni-forge', 'pnt-vulcan-1'],
        lanes: { 'pnt-ignis-1': 'pnt-vulcan-1', 'pnt-ardor-1': 'veni-forge' },
      }),
    );
    const byAgent = Object.fromEntries(dock.before.map((cell) => [cell.agent, cell.text]));

    expect(Object.keys(byAgent).sort()).toEqual(['pnt-vulcan-1', 'veni-forge']);
    expect(byAgent['pnt-vulcan-1']).toContain('+1 helper');
    expect(byAgent['veni-forge']).toContain('+1 helper');
    expect(dock.count).toBe('2 agents');
    expect(dock.errors).toEqual([]);
  });

  test('a lane with no helper at work says nothing about helpers', async () => {
    const dock = await measure(
      dataWith({ roster: ['veni-forge', 'pnt-vulcan-1'], lanes: { 'nobody-yet': 'veni-forge' } }),
    );

    expect(dock.before.every((cell) => !cell.text.includes('helpers'))).toBe(true);
  });

  test('a helper keeps its own name on its lines in the detail of a flow', async () => {
    const data = dataWith({
      roster: ['veni-forge', 'pnt-vulcan-1'],
      lanes: { 'pnt-ignis-1': 'pnt-vulcan-1', 'pnt-ardor-1': 'veni-forge' },
    });
    const raw = await BrowserPage.measure<string>({
      html: withErrors(BoardPage.render({ data })),
      width: 1440,
      dark: false,
      expression: `(() => {
        const names = new Set();
        for (const fl of FL) for (const e of fl.evs) names.add(e.as || e.actor);
        return JSON.stringify({ names: [...names], errors: window.__errs });
      })()`,
    });
    const seen: { names: string[]; errors: string[] } = JSON.parse(raw);

    expect(seen.names).toEqual(expect.arrayContaining(['pnt-ignis-1', 'pnt-ardor-1']));
    expect(seen.errors).toEqual([]);
  });
});
