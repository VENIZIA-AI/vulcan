import { afterAll, describe, expect, test } from 'bun:test';
import type { IBoardAgent, IBoardData } from '../../board/common/index.ts';
import { BoardPage } from '../../board/page.ts';
import { BoardI18n } from '../../board/ui/i18n/translate.ts';
import { BoardLatest } from '../../board/ui/state/latest.ts';
import { BoardView } from '../../board/ui/state/view.ts';
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
  const cells = () => [...document.querySelectorAll('#dock [data-agent]')];
  const before = cells().map((c) => ({ agent: c.dataset.agent, text: c.innerText }));
  const count = document.querySelector('#dock .c-n').textContent;
  document.getElementById('bPlumb').click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const result = {
    before,
    count,
    afterToggle: cells().map((c) => c.dataset.agent),
    countAfterToggle: document.querySelector('#dock .c-n').textContent,
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
    expect(dock.count).toBe('2');
    expect(dock.afterToggle.sort()).toEqual([
      'pnt-ardor-1',
      'pnt-ignis-1',
      'pnt-vulcan-1',
      'veni-forge',
    ]);
    expect(dock.countAfterToggle).toBe('4');
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
    expect(dock.count).toBe('2');
    expect(dock.errors).toEqual([]);
  });

  test('a lane says "+2 helpers" for two, and nothing when none has worked', async () => {
    const two = await measure(
      dataWith({
        roster: ['veni-forge', 'pnt-vulcan-1'],
        lanes: { 'pnt-ignis-1': 'pnt-vulcan-1', 'pnt-ardor-1': 'pnt-vulcan-1' },
      }),
    );
    const none = await measure(
      dataWith({ roster: ['veni-forge', 'pnt-vulcan-1'], lanes: { 'nobody-yet': 'veni-forge' } }),
    );
    const vulcan = two.before.find((cell) => cell.agent === 'pnt-vulcan-1');
    const forge = two.before.find((cell) => cell.agent === 'veni-forge');

    expect(vulcan?.text).toContain('+2 helpers');
    expect(forge?.text).not.toContain('helper');
    expect(none.before.every((cell) => !cell.text.includes('helper'))).toBe(true);
  });

  test('an idle lane still shows its helpers', async () => {
    const base = dataWith({});
    const at = new Date().toISOString();
    const idle: IBoardAgent = {
      name: 'quiet',
      state: 'idle',
      current: '',
      since: at,
      checkedAt: at,
    };
    const raw = await BrowserPage.measure<string>({
      html: withErrors(
        BoardPage.render({
          data: {
            ...base,
            agents: {
              ...base.agents,
              quiet: idle,
              'quiet-helper': { ...idle, name: 'quiet-helper' },
            },
            roster: ['veni-forge', 'quiet'],
            lanes: { 'quiet-helper': 'quiet' },
          },
        }),
      ),
      width: 1440,
      dark: false,
      expression: `(() => {
        const card = document.querySelector('#dock [data-agent="quiet"]');
        return JSON.stringify({ idle: card.classList.contains('idle'), foot: card.querySelector('.c-foot').textContent, errors: window.__errs });
      })()`,
    });
    const seen: { idle: boolean; foot: string; errors: string[] } = JSON.parse(raw);

    expect(seen.idle).toBe(true);
    expect(seen.foot).toContain('+1 helper');
    expect(seen.errors).toEqual([]);
  });
});

describe.skipIf(!hasBrowser)('the name of a helper in the detail, and who holds a flow', () => {
  const lanes = { 'pnt-ignis-1': 'pnt-vulcan-1', 'pnt-ardor-1': 'veni-forge' };
  const roster = ['veni-forge', 'pnt-vulcan-1'];

  test('a line is drawn as the lane, and the Latest sentence shows the helper, sender and recipient', () => {
    const data = dataWith({ roster, lanes });
    const flow = {
      ...data.flows[0],
      events: [
        {
          ...data.flows[0].events[0],
          id: 'x',
          kind: 'msg',
          actor: 'pnt-ignis-1',
          to: 'pnt-ardor-1',
          summary: 'hello',
        },
      ],
    };
    const [sent] = BoardView.linesOf({ data, flow, showAll: true });
    const latest = BoardLatest.textOf({
      event: sent,
      translate: (key) => BoardI18n.translate({ language: 'en', key }),
    });
    const actors = new Set(
      BoardView.eventsOf({ data, showAll: false }).map((event) => event.actor),
    );

    expect(sent.actor).toBe('pnt-vulcan-1');
    expect(sent.to).toBe('veni-forge');
    expect([sent.as, sent.asTo]).toEqual(['pnt-ignis-1', 'pnt-ardor-1']);
    expect(latest.startsWith('pnt-ignis-1 ')).toBe(true);
    expect(latest).toContain('pnt-ardor-1');
    expect(actors).not.toContain('pnt-ignis-1');
    expect(actors).not.toContain('pnt-ardor-1');
  });

  test('the detail of a real flow shows the helper that wrote a line, not the lane', async () => {
    const data = dataWith({ roster, lanes });
    const helperFlow = BoardView.flowsOf({ data, showAll: false, lastSeen: '' }).find((view) =>
      view.evs.some((event) => event.as === 'pnt-ignis-1'),
    )?.flow.id;

    const raw = await BrowserPage.measure<string>({
      html: withErrors(BoardPage.render({ data })),
      width: 1440,
      dark: false,
      expression: `(async () => {
        const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
        document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
        await wait();
        document.querySelector('.row[data-id="${helperFlow}"]').click();
        await wait();
        document.querySelector('.d-all').click();
        await wait();
        const who = [...document.querySelectorAll('#dBody .evs .who b:first-child')].map((b) => b.textContent);
        return JSON.stringify({ who, errors: window.__errs });
      })()`,
    });
    const seen: { who: string[]; errors: string[] } = JSON.parse(raw);

    expect(seen.who).toContain('pnt-ignis-1');
    expect(seen.errors).toEqual([]);
  });

  test('a flow held by a helper shows the lane as its holder; with no lane it shows the helper', async () => {
    const holders = async (data: IBoardData): Promise<string[]> => {
      const raw = await BrowserPage.measure<string>({
        html: withErrors(BoardPage.render({ data })),
        width: 1440,
        dark: false,
        expression: `(async () => {
          document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
          await new Promise((resolve) => setTimeout(resolve, 80));
          return JSON.stringify([...document.querySelectorAll('#groups .row .c-chips .h')].map((node) => node.textContent.replace(/ holds$/, '')));
        })()`,
      });
      const names: string[] = JSON.parse(raw);

      return names;
    };
    const without = await holders(dataWith({}));
    const withLanes = await holders(dataWith({ roster, lanes }));

    expect(without).toContain('pnt-ignis-1');
    expect(withLanes).not.toContain('pnt-ignis-1');
    expect(withLanes).toContain('pnt-vulcan-1');
  });

  test('an agent the roster does not list can still hold a flow: the flow shows it, the dock does not', async () => {
    const raw = await BrowserPage.measure<string>({
      html: withErrors(BoardPage.render({ data: dataWith({ roster: ['veni-forge'] }) })),
      width: 1440,
      dark: false,
      expression: `(async () => {
        document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
        await new Promise((resolve) => setTimeout(resolve, 80));
        return JSON.stringify({
          holders: [...document.querySelectorAll('#groups .row .c-chips .h')].map((node) => node.textContent.replace(/ holds$/, '')),
          dock: [...document.querySelectorAll('#dock [data-agent]')].map((cell) => cell.dataset.agent),
        });
      })()`,
    });
    const seen: { holders: string[]; dock: string[] } = JSON.parse(raw);

    expect(seen.holders).toContain('pnt-vulcan-1');
    expect(seen.dock).toEqual(['veni-forge']);
  });
});
