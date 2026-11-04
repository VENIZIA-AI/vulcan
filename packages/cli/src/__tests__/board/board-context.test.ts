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
  /** The class of each block of the heading area, top to bottom. */
  blocks: string[];
  heading: string;
  context: string | null;
  next: string | null;
  latest: string[];
  stages: string[];
  noWork: string | null;
  sources: string[];
  text: string;
  allText: string;
  overflow: boolean;
}

interface IRow {
  title: string;
  strip: string;
  last: string;
}

interface IResult {
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
  const pane = async (id) => {
    document.querySelector('.row[data-id="' + id + '"]').click();
    await wait();
    const body = document.getElementById('dBody');
    const dh = body.querySelector('.dh');
    const q = (s) => (body.querySelector(s) ? body.querySelector(s).textContent : null);
    const result = {
      blocks: [...dh.children].map((c) => c.className.split(' ')[0] || c.tagName.toLowerCase()),
      heading: body.querySelector('h3').firstChild.textContent,
      context: q('.ctx p'),
      next: q('.nx'),
      latest: [...body.querySelectorAll('.lat li')].map((li) => li.textContent),
      stages: [...body.querySelectorAll('.tl .st .nm')].map((n) => n.textContent),
      noWork: q('.nowork'),
      sources: [...body.querySelectorAll('.ev .src')].map((n) => n.textContent),
      text: body.textContent,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
    const tabs = [...body.querySelectorAll('.dtabs .tab')];
    tabs[1].click();
    await wait();
    result.allText = document.getElementById('dBody').textContent;
    document.getElementById('dBody').querySelectorAll('.dtabs .tab')[0].click();
    await wait();
    return result;
  };
  if (document.documentElement.lang !== 'en') { document.getElementById('bLang').click(); await wait(); }
  const rowsOf = () => {
    const rows = {};
    for (const row of document.querySelectorAll('.row')) {
      rows[row.dataset.id] = {
        title: row.querySelector('.tt .t').textContent,
        strip: row.querySelector('.strip').textContent,
        last: row.querySelector('.sub .last').textContent,
      };
    }
    return rows;
  };
  out.rows = rowsOf();
  out.one = await pane('F-1');
  out.two = await pane('F-2');
  document.getElementById('bLang').click();
  await wait();
  out.vi = { one: await pane('F-1'), rows: rowsOf() };
  document.getElementById('bLang').click();
  await wait();
  return JSON.stringify(out);
})()`;

describe.skipIf(!hasBrowser)(
  'the detail pane of a flow: context, next step and latest lines',
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
        test(`${width}px, ${dark ? 'dark' : 'light'}: title, why, context, next, latest, then the stages`, async () => {
          const { one, errors } = await run({ dark, width });

          expect(errors).toEqual([]);
          expect(one.heading).toBe('Show the context of a flow');
          expect(one.blocks.slice(0, 2)).toEqual(['top', 'h3']);
          // Title, why, Context, Next, Latest, in this order, before the facts and the stages.
          expect(
            one.blocks.filter((block) => ['h3', 'why', 'ctx', 'nx', 'lat'].includes(block)),
          ).toEqual(['h3', 'why', 'ctx', 'nx', 'lat']);
          expect(one.context).toBe(CONTEXT);
          expect(one.next).toBe('Next: agent-a-1 opens the pull request');
          expect(one.overflow).toBe(false);
        });
      }
    }

    test('Latest holds the three newest lines of work, newest first, one sentence each; no plumbing, no title line', async () => {
      const { one } = await run({ dark: false, width: 1440 });

      expect(one.latest).toHaveLength(3);
      expect(one.latest[0]).toMatch(/^\d\d:\d\d\s*agent-a-1 committed: third$/);
      expect(one.latest[1]).toMatch(/^\d\d:\d\d\s*agent-a-1 wrote to agent-b-1: status label$/);
      expect(one.latest[2]).toMatch(/^\d\d:\d\d\s*agent-a-1 committed: second$/);
      expect(one.latest.join(' ')).not.toContain('turn ended');
      expect(one.latest.join(' ')).not.toContain('Show the context of a flow');
    });

    test('the stages hold work only, and no line prints the tag of the tool that wrote it', async () => {
      const { one, two } = await run({ dark: false, width: 1440 });

      expect(one.stages.length).toBeGreaterThan(0);
      expect(one.stages).not.toContain('Proposal');
      expect(one.sources).toEqual([]);
      expect(one.text).not.toMatch(/\bcli\b/);
      expect(one.allText).not.toMatch(/\bcli\b/);
      expect(two.allText).not.toMatch(/\bcli\b/);
    });

    test('a flow with only a flow line says no work is logged, and shows no stage box', async () => {
      const { two } = await run({ dark: false, width: 1440 });

      expect(two.heading).toBe('Only a title so far');
      expect(two.context).toBe('Nothing has started.');
      expect(two.next).toBe('Next: agent-b-1 starts the design');
      expect(two.latest).toEqual([]);
      expect(two.stages).toEqual([]);
      expect(two.noWork).toBe('No work logged yet');
      expect(two.text).not.toContain('Proposal');
      expect(two.text).not.toMatch(/1 events?/);
    });

    test('the list row of a flow with no work has no stage chip, and says its next step, else its reason, never its title', async () => {
      const { rows } = await run({ dark: false, width: 1440 });

      expect(rows['F-1'].strip).toContain('Code');
      expect(rows['F-1'].last).toBe('third');
      expect(rows['F-2']).toEqual({
        title: 'Only a title so far',
        strip: 'No work yet',
        last: 'agent-b-1 starts the design',
      });
      expect(rows['F-3']).toMatchObject({
        strip: 'No work yet',
        last: 'the reason of the third flow',
      });
      expect(rows['F-4']).toMatchObject({
        title: 'Only a bare title',
        strip: 'No work yet',
        last: '',
      });
      expect(rows['F-2'].strip).not.toContain('Proposal');
    });

    test('Vietnamese: the labels and the sentences are translated, none is a key', async () => {
      const { vi } = await run({ dark: false, width: 1440 });

      expect(vi.one.text).toContain('Bối cảnh');
      expect(vi.one.text).toContain('Tiếp theo');
      expect(vi.one.text).toContain('Mới nhất');
      expect(vi.rows['F-2'].strip).toBe('Chưa có việc');
      expect(vi.one.latest[0]).toContain('commit');
      expect(vi.one.text).not.toMatch(/\b(?:lt|ctx|nx|nw)\.[a-z]/);
    });
  },
);
