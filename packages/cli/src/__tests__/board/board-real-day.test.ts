import { afterAll, describe, expect, test } from 'bun:test';
import { BoardPage } from '../../board/page.ts';
import { BoardFace } from '../../board/ui/components/face.tsx';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { REAL_DAY, realDayData } from './real-day.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

interface IResult {
  agents: string[];
  agentCount: string;
  earlier: string | null;
  afterEarlier: string[];
  itemCount: string;
  cards: Record<string, string>;
  groups: Record<string, string>;
  rowIds: string[];
  loose: string | null;
  looseDetail: { heading: string; lines: number; stageBars: number } | null;
  groupsText: string;
  scrollsSideways: boolean;
  errors: string[];
}

const EXPRESSION = `(async () => {
  localStorage.clear();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
  const out = { errors: window.__errs };
  document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
  await wait();
  out.agents = [...document.querySelectorAll('#dock [data-agent]')].map((c) => c.dataset.agent);
  out.agentCount = document.querySelector('#dock .c-n').textContent;
  out.itemCount = document.getElementById('flowN').textContent;
  const earlier = document.querySelector('#dock .c-loose');
  out.earlier = earlier ? earlier.textContent : null;
  if (earlier) { earlier.click(); await wait(); }
  out.afterEarlier = [...document.querySelectorAll('#dock [data-agent]')].map((c) => c.dataset.agent);
  if (earlier) { earlier.click(); await wait(); }
  out.cards = Object.fromEntries([...document.querySelectorAll('#dock [data-agent]')].map((c) => [c.dataset.agent, c.innerText]));
  out.groups = Object.fromEntries([...document.querySelectorAll('#groups .c-group')].map((g) => [g.querySelector('.c-gh').textContent.split(' · ')[0].trim(), g.querySelector('.c-gh').textContent]));
  out.rowIds = [...document.querySelectorAll('#groups .row')].map((r) => r.dataset.id);
  out.groupsText = document.getElementById('groups').innerText;
  const loose = document.querySelector('#groups .c-loose');
  out.loose = loose ? loose.textContent : null;
  out.looseDetail = null;
  if (loose) {
    loose.click();
    await wait();
    out.looseDetail = {
      heading: document.querySelector('#dBody h2').textContent,
      lines: document.querySelectorAll('#dBody .evs li').length,
      stageBars: document.querySelectorAll('#dBody .d-stages').length,
    };
  }
  out.scrollsSideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  return JSON.stringify(out);
})()`;

describe.skipIf(!hasBrowser)('a busy multi-agent day, in a real browser', () => {
  const html = BoardPage.render({ data: realDayData() }).replace(
    '<script type="application/json"',
    '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
  );
  const run = async (width: number): Promise<IResult> => {
    const raw = await BrowserPage.measure<string>({
      html,
      width,
      dark: false,
      expression: EXPRESSION,
    });

    return JSON.parse(raw) as IResult;
  };

  for (const width of [1440, 390]) {
    test(`${width}px: every actor has a card, none is Unsorted work, no marker, nothing sticks out`, async () => {
      const result = await run(width);

      expect(result.errors).toEqual([]);
      // The agents heard from in the last day are cards; the others are folded under Earlier, still one click away.
      expect([...result.agents].sort()).toEqual(
        REAL_DAY.ACTORS.filter((name) => name !== 'acme-old'),
      );
      expect(result.agents[0]).toBe('acme-forge');
      expect(result.agentCount).toBe(String(REAL_DAY.ACTORS.length - REAL_DAY.EARLIER));
      expect(result.earlier).toBe(`Earlier (${REAL_DAY.EARLIER})`);
      expect([...result.afterEarlier].sort()).toEqual([...REAL_DAY.ACTORS]);
      expect(result.rowIds).not.toContain('Unsorted');
      expect(result.groupsText).not.toMatch(/no title yet|chưa có tên/);
      expect(result.scrollsSideways).toBe(false);
    });
  }

  test('the cards tell the truth: a few unanswered messages, working after the stop, a lane label', async () => {
    const { cards } = await run(1440);

    expect(cards['pnt-web-1']).toMatch(/Unanswered\s*3\b/);
    expect(cards['pnt-web-1']).not.toMatch(/Idle/);
    expect(cards['acme-late']).toMatch(/Idle/);
    expect(cards['acme-late']).not.toMatch(/Working/);
    expect(cards['acme-forge']).toMatch(/Unanswered\s*0\b/);
    expect(cards['pnt-api-1']).toContain('under acme-api');
    expect(cards['acme-api']).toContain('Backend');

    for (const [name, text] of Object.entries(cards)) {
      const count = Number(/Unanswered\s*(\d+)/.exec(text)?.[1]);

      expect(count, name).toBeLessThanOrEqual(REAL_DAY.UNANSWERED);
    }
  });

  test('closed flows are in Done and Parked, not Running: a merge, a deploy, a park; a stale merge is past the week', async () => {
    const { groups, rowIds, itemCount } = await run(1440);

    expect(groups['Needs you']).toContain('· 1');
    expect(groups['Running']).toContain('· 4');
    expect(groups['Parked']).toContain('· 1');
    expect(groups['Done this week']).toContain('· 3');
    // The count is the cards listed: five open, three done this week; the stale one and Unsorted are not counted.
    expect(itemCount).toBe('9');
    expect(rowIds).toContain(REAL_DAY.DEPLOYED);
    expect(rowIds).toContain(REAL_DAY.DONE_OLD);
    expect(rowIds).not.toContain(REAL_DAY.DONE_STALE);
  });

  test('the lines with no flow are one muted line under the groups; it opens a list, not a work item', async () => {
    const { loose, looseDetail } = await run(1440);

    expect(loose).toBe(`Unsorted · ${REAL_DAY.UNSORTED + REAL_DAY.TO_SOCKETS}`);
    expect(looseDetail?.heading).toBe('Unsorted');
    expect(looseDetail?.lines).toBe(REAL_DAY.UNSORTED + REAL_DAY.TO_SOCKETS);
    expect(looseDetail?.stageBars).toBe(0);
  });

  test('the Details toggle of the agents pane: full cards by default, one compact row each when off, and the choice is kept', async () => {
    const raw = await BrowserPage.measure<string>({
      html,
      width: 1440,
      dark: false,
      expression: `(async () => {
        localStorage.clear();
        const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
        const count = (selector) => document.querySelectorAll('#dock ' + selector).length;
        const out = { errors: window.__errs, on: { cards: count('[data-agent]'), bodies: count('.c-body'), compact: count('.c-compact') } };
        document.querySelector('.c-tg').click();
        await wait();
        const web = document.querySelector('#dock [data-agent="acme-web"]');
        out.off = {
          cards: count('[data-agent]'),
          bodies: count('.c-body'),
          compact: count('.c-compact'),
          pressed: document.querySelector('.c-tg').getAttribute('aria-pressed'),
          stored: localStorage.getItem('board:acme:agentDetails'),
          webText: web.innerText,
          askDots: count('.c-ask'),
          webDot: !!web.querySelector('.c-ask'),
        };
        document.querySelector('.c-tg').click();
        await wait();
        out.back = { bodies: count('.c-body'), stored: localStorage.getItem('board:acme:agentDetails') };
        return JSON.stringify(out);
      })()`,
    });
    const seen: {
      errors: string[];
      on: { cards: number; bodies: number; compact: number };
      off: {
        cards: number;
        bodies: number;
        compact: number;
        pressed: string;
        stored: string;
        webText: string;
        askDots: number;
        webDot: boolean;
      };
      back: { bodies: number; stored: string };
    } = JSON.parse(raw);

    expect(seen.errors).toEqual([]);
    expect(seen.on.bodies).toBe(seen.on.cards);
    expect(seen.on.compact).toBe(0);
    expect(seen.off.cards).toBe(seen.on.cards);
    expect(seen.off.compact).toBe(seen.on.cards);
    expect(seen.off.bodies).toBe(0);
    expect(seen.off.pressed).toBe('false');
    expect(seen.off.stored).toBe('0');
    // A row says who, how it is, and the flow it works on; a red dot only for the one that asks the owner.
    expect(seen.off.webText).toContain('acme-web');
    expect(seen.off.webText).toContain(REAL_DAY.YOU);
    expect(seen.off.askDots).toBe(1);
    expect(seen.off.webDot).toBe(true);
    expect(seen.back.bodies).toBe(seen.on.cards);
    expect(seen.back.stored).toBe('1');
  });

  test('the mascot of each state: a hoe at work, asleep when idle, a "?" bubble when it asks, a mark when stuck; in both modes', async () => {
    const blockedData = realDayData();

    for (const flow of blockedData.flows) {
      if (flow.id === REAL_DAY.CART) {
        flow.state = 'blocked';
      }
    }

    const page = BoardPage.render({ data: blockedData }).replace(
      '<script type="application/json"',
      '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
    );
    const raw = await BrowserPage.measure<string>({
      html: page,
      width: 1440,
      dark: false,
      expression: `(async () => {
        localStorage.clear();
        const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
        const parts = (name) => {
          const svg = document.querySelector('#dock [data-agent="' + name + '"] svg.bot');
          return {
            hoe: !!svg.querySelector('.m-hoe'),
            sleep: !!svg.querySelector('.m-sleep'),
            bubble: !!svg.querySelector('.m-bubble'),
            wave: !!svg.querySelector('.m-wave'),
            stuck: !!svg.querySelector('circle[fill="var(--fail)"]'),
            fills: [...svg.querySelectorAll('.m-dig path, .m-lean path, .m-sleep path')].slice(0, 1).map((p) => p.getAttribute('fill')),
          };
        };
        const full = {
          working: parts('acme-forge'),
          idle: parts('acme-api'),
          you: parts('acme-web'),
          blocked: parts('pnt-web-1'),
        };
        document.querySelector('.c-tg').click();
        await wait();
        const compact = { working: parts('acme-forge'), idle: parts('acme-api'), you: parts('acme-web') };
        document.querySelector('#dock [data-agent="acme-forge"]').click();
        await wait();
        const detail = { hoe: !!document.querySelector('#dBody svg.bot .m-hoe') };
        return JSON.stringify({ full, compact, detail, errors: window.__errs });
      })()`,
    });
    const seen: {
      full: Record<
        string,
        {
          hoe: boolean;
          sleep: boolean;
          bubble: boolean;
          wave: boolean;
          stuck: boolean;
          fills: string[];
        }
      >;
      compact: Record<string, { hoe: boolean; sleep: boolean; bubble: boolean }>;
      detail: { hoe: boolean };
      errors: string[];
    } = JSON.parse(raw);

    expect(seen.errors).toEqual([]);
    expect(seen.full.working).toMatchObject({ hoe: true, sleep: false, bubble: false });
    expect(seen.full.idle).toMatchObject({ hoe: false, sleep: true, bubble: false });
    expect(seen.full.you).toMatchObject({ hoe: false, sleep: false, bubble: true, wave: true });
    expect(seen.full.blocked).toMatchObject({
      hoe: false,
      sleep: false,
      bubble: false,
      stuck: true,
    });
    // An agent's colour is the same wherever it is drawn: here and in the detail, the same fill.
    expect(seen.full.working.fills[0]).toBe(BoardFace.colorOf({ name: 'acme-forge' }));
    expect(seen.compact.working.hoe).toBe(true);
    expect(seen.compact.idle.sleep).toBe(true);
    expect(seen.compact.you.bubble).toBe(true);
    expect(seen.detail.hoe).toBe(true);
  });
});
