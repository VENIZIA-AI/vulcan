import { afterAll, describe, expect, test } from 'bun:test';
import { BoardFold } from '../../board/fold.ts';
import { BoardPage } from '../../board/page.ts';
import type { IBoardData } from '../../board/common/index.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { line } from './log-lines.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const BASE = Date.now() - 120 * 60_000;
const ME = 'agent-a-1';
const CONTEXT =
  'The board shows a flow as a title and little else. This adds what the flow is and what is left, so a reader needs no other page. The fold is done; the page and the docs are left.';

/** Text that would run, or break the page, if it were put in as markup. */
const HOSTILE = '</script><img src=x onerror="window.__pwn=1"><b id=pwn>bold</b>';

/** F-1 has a title, a context, a next step and five lines of work; F-2 has only a flow line. */
const data = (): IBoardData => {
  const lines = [
    line({
      base: BASE,
      minute: 1,
      kind: 'flow',
      actor: ME,
      flow: 'F-1',
      summary: 'Show the context of a flow',
      why: 'an owner reads one pane and understands',
      context: CONTEXT,
      next: 'agent-a-1 opens the pull request',
    }),
    line({
      base: BASE,
      minute: 2,
      kind: 'commit',
      actor: ME,
      flow: 'F-1',
      summary: 'first',
      ref: 'a1',
    }),
    line({
      base: BASE,
      minute: 3,
      kind: 'commit',
      actor: ME,
      flow: 'F-1',
      summary: 'second',
      ref: 'a2',
    }),
    line({
      base: BASE,
      minute: 4,
      kind: 'msg-sent',
      actor: ME,
      flow: 'F-1',
      summary: 'status label',
      ref: 'to:agent-b-1',
    }),
    line({
      base: BASE,
      minute: 5,
      kind: 'session-stop',
      actor: ME,
      flow: 'F-1',
      summary: 'turn ended',
    }),
    line({
      base: BASE,
      minute: 6,
      kind: 'commit',
      actor: ME,
      flow: 'F-1',
      summary: 'third',
      ref: 'a3',
    }),
    line({
      base: BASE,
      minute: 7,
      kind: 'flow',
      actor: 'agent-b-1',
      flow: 'F-2',
      summary: 'Only a title so far',
      context: 'Nothing has started.',
      next: 'agent-b-1 starts the design',
    }),
    // A received line that names a recipient: it still has a sender, not a recipient.
    line({
      base: BASE,
      minute: 3,
      kind: 'msg-received',
      actor: ME,
      flow: 'F-1',
      summary: 'stray',
      ref: 'to:agent-b-1',
    }),
    line({
      base: BASE,
      minute: 7,
      kind: 'msg-received',
      actor: ME,
      flow: 'F-1',
      summary: 'reply',
      ref: 'from:agent-b-1',
    }),
    line({
      base: BASE,
      minute: 10,
      kind: 'flow',
      actor: 'agent-b-1',
      flow: 'F-5',
      summary: 'Text that is not markup',
      context: HOSTILE,
      next: HOSTILE,
    }),
    line({
      base: BASE,
      minute: 8,
      kind: 'flow',
      actor: 'agent-b-1',
      flow: 'F-3',
      summary: 'Only a title and a reason',
      why: 'the reason of the third flow',
    }),
    line({
      base: BASE,
      minute: 9,
      kind: 'flow',
      actor: 'agent-b-1',
      flow: 'F-4',
      summary: 'Only a bare title',
    }),
  ];
  const log = BoardFold.fromLog({ events: lines });
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: 'Ana' });

  return {
    title: 'Acme Board',
    owner: 'Ana',
    key: 'acme',
    shapes: {},
    generatedAt: new Date(BASE + 130 * 60_000).toISOString(),
    since: new Date(BASE - 60_000).toISOString(),
    flows,
    decisions,
    agents: log.agents,
    sources: ['event log: 7 line(s)'],
  };
};

interface IPane {
  heading: string;
  context: string | null;
  meta: string;
  stages: number;
  current: string | null;
  milestones: string[];
  noWork: string | null;
  text: string;
  allText: string;
  overflow: boolean;
}

interface IRow {
  title: string;
  badge: string;
  now: string | null;
}

interface IResult {
  pending: string[];
  hostile: {
    context: string | null;
    now: string | null;
    images: number;
    bold: number;
    ran: boolean;
  };
  rows: Record<string, IRow>;
  one: IPane;
  two: IPane;
  vi: { one: IPane; rows: Record<string, IRow> };
  errors: string[];
}

const EXPRESSION = `(async () => {
  localStorage.clear();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  const out = { errors: window.__errs };
  const text = (selector) => (document.querySelector(selector) ? document.querySelector(selector).textContent : null);
  const pane = async (id) => {
    document.querySelector('.row[data-id="' + id + '"]').click();
    await wait();
    const result = {
      heading: document.querySelector('#dBody h2').firstChild.textContent,
      context: text('#dBody .d-sec p'),
      meta: text('#dBody .d-meta'),
      stages: document.querySelectorAll('#dBody .d-stages .st').length,
      current: text('#dBody .d-stl b'),
      milestones: [...document.querySelectorAll('#dBody .d-u')].map((u) => u.textContent),
      noWork: text('#dBody .d-empty'),
      text: document.getElementById('dBody').textContent,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
    document.querySelector('.d-all').click();
    await wait();
    result.allText = document.getElementById('dBody').textContent;
    document.querySelector('.d-all').click();
    await wait();
    return result;
  };
  const rowsOf = () => {
    const rows = {};
    for (const row of document.querySelectorAll('.row')) {
      rows[row.dataset.id] = {
        title: row.querySelector('.c-title').firstChild.textContent,
        badge: row.querySelector('.c-badge').textContent,
        now: row.querySelector('.c-now') ? row.querySelector('.c-now').textContent : null,
      };
    }
    return rows;
  };
  document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
  await wait();
  if (document.documentElement.lang !== 'en') { document.getElementById('bLang').click(); await wait(); }
  out.rows = rowsOf();
  out.one = await pane('F-1');
  out.two = await pane('F-2');
  document.querySelector('.row[data-id="F-5"]').click();
  await wait();
  out.hostile = {
    context: text('#dBody .d-sec p'),
    now: text('.row[data-id="F-5"] .c-now'),
    images: document.querySelectorAll('#dBody img, #groups img').length,
    bold: document.querySelectorAll('#pwn').length,
    ran: window.__pwn !== undefined,
  };
  document.querySelector('#dock [data-agent="agent-a-1"]').click();
  await wait();
  const section = [...document.querySelectorAll('#dBody .d-sec')].find((one) => /nswered/.test(one.querySelector('h4').textContent));
  out.pending = [...section.querySelectorAll('li')].map((li) => li.textContent);
  document.querySelector('#dock [data-agent="agent-a-1"]').click();
  await wait();
  document.getElementById('bLang').click();
  await wait();
  out.vi = { one: await pane('F-1'), rows: rowsOf() };
  document.getElementById('bLang').click();
  await wait();
  return JSON.stringify(out);
})()`;

describe.skipIf(!hasBrowser)(
  'the detail of a flow in the three panes: what it is, how far, how it went',
  () => {
    const html = BoardPage.render({ data: data() }).replace(
      '<script type="application/json"',
      '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
    );
    const run = async (opts: { dark: boolean; width: number }): Promise<IResult> => {
      const raw = await BrowserPage.measure<string>({
        html,
        width: opts.width,
        dark: opts.dark,
        expression: EXPRESSION,
      });

      return JSON.parse(raw) as IResult;
    };

    for (const width of [1440, 390]) {
      for (const dark of [false, true]) {
        test(`${width}px, ${dark ? 'dark' : 'light'}: the title, the stage bar, what it is, and nothing sticks out`, async () => {
          const { one, errors } = await run({ dark, width });

          expect(errors).toEqual([]);
          expect(one.heading).toBe('Show the context of a flow');
          expect(one.context).toBe(CONTEXT);
          expect(one.meta).toContain('F-1');
          expect(one.stages).toBe(9);
          expect(one.current).toBe('Code');
          expect(one.overflow).toBe(false);
        });
      }
    }

    test('a card says what is happening now: the next step, else the reason, else nothing; and where the flow is', async () => {
      const { rows } = await run({ dark: false, width: 1440 });

      expect(rows['F-1']).toMatchObject({
        badge: 'Code',
        now: 'Now: agent-a-1 opens the pull request',
      });
      expect(rows['F-2']).toEqual({
        title: 'Only a title so far',
        badge: 'No work yet',
        now: 'Now: agent-b-1 starts the design',
      });
      expect(rows['F-3']).toMatchObject({
        badge: 'No work yet',
        now: 'Now: the reason of the third flow',
      });
      expect(rows['F-4']).toMatchObject({
        title: 'Only a bare title',
        badge: 'No work yet',
        now: null,
      });
    });

    test('a flow with only a flow line says no work is logged, and shows no stage bar', async () => {
      const { two } = await run({ dark: false, width: 1440 });

      expect(two.heading).toBe('Only a title so far');
      expect(two.context).toBe('Nothing has started.');
      expect(two.noWork).toBe('No work logged yet');
      expect(two.stages).toBe(0);
      expect(two.text).not.toContain('Proposal');
    });

    test('the milestones are the way it went, newest first; the lines of work are behind All events, with no plumbing and no tool tag', async () => {
      const { one } = await run({ dark: false, width: 1440 });

      expect(one.milestones).toHaveLength(1);
      expect(one.milestones[0]).toContain('Opened');
      expect(one.text).not.toContain('status label');
      expect(one.allText).toContain('status label');
      expect(one.allText).not.toContain('turn ended');
      expect(one.allText).not.toMatch(/\bcli\b/);
      // A received line that names a recipient has a sender, not a recipient: one arrow, and the sender's line.
      expect(one.allText.match(/→ agent-b-1/g)).toHaveLength(1);
      expect(one.allText).toContain('agent-a-1 ← agent-b-1');
    });

    test('the agent detail lists the messages to it after its last sent one, each with its direction, never undefined', async () => {
      const { pending } = await run({ dark: false, width: 1440 });

      expect(pending.join('\n')).not.toContain('undefined');
      expect(pending.some((entry) => /← agent-b-1: reply$/.test(entry))).toBe(true);
      // It sent "status label" before the reply came, so the reply is the only one it has not answered.
      expect(pending).toHaveLength(1);
      expect(pending.some((entry) => /→ agent-b-1/.test(entry))).toBe(false);
    });

    test('context and next are text: markup in them neither runs nor becomes elements', async () => {
      const { hostile, errors } = await run({ dark: false, width: 1440 });

      expect(errors).toEqual([]);
      expect(hostile.context).toBe(HOSTILE);
      expect(hostile.now).toBe(`Now: ${HOSTILE}`);
      expect(hostile.images).toBe(0);
      expect(hostile.bold).toBe(0);
      expect(hostile.ran).toBe(false);
    });

    test('Vietnamese: the labels and the badges are translated, none is a key', async () => {
      const { vi } = await run({ dark: false, width: 1440 });

      expect(vi.one.text).toContain('Đây là gì');
      expect(vi.one.text).toContain('Diễn biến');
      expect(vi.rows['F-2'].badge).toBe('Chưa có việc');
      expect(vi.rows['F-2'].now).toContain('Đang:');
      expect(vi.one.text).not.toMatch(/\b(?:dt|it|ms|ag|pn)\.[a-z]/);
    });
  },
);
