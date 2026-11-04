import { afterAll, describe, expect, test } from 'bun:test';
import { BoardFold } from '../../board/fold.ts';
import { BoardPage } from '../../board/page.ts';
import type { IBoardData } from '../../board/common/index.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { line } from './log-lines.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const BASE = Date.now() - 120 * 60_000;
const ME = 'pnt-vulcan-1';

/** F-1 is named and has plumbing around it, F-2 has no name, F-3 waits on a person, and one flow is plumbing only. */
const data = (): IBoardData => {
  const lines = [
    line({
      base: BASE,
      minute: 1,
      kind: 'flow',
      actor: ME,
      flow: 'F-1',
      summary: 'Bảng việc cho anh',
      why: 'để anh thấy việc nào chờ anh',
    }),
    line({
      base: BASE,
      minute: 2,
      kind: 'commit',
      actor: ME,
      flow: 'F-1',
      summary: 'the lock',
      ref: 'abc1234',
    }),
    line({
      base: BASE,
      minute: 3,
      kind: 'msg-sent',
      actor: ME,
      flow: 'F-1',
      summary: 'status label',
      ref: 'to:veni-forge',
    }),
    line({
      base: BASE,
      minute: 4,
      kind: 'session-stop',
      actor: ME,
      flow: 'F-1',
      summary: 'turn ended',
    }),
    line({
      base: BASE,
      minute: 5,
      kind: 'needs-owner',
      actor: ME,
      flow: 'F-1',
      summary: 'idle_prompt',
    }),
    line({
      base: BASE,
      minute: 6,
      kind: 'commit',
      actor: 'pnt-ignis-1',
      flow: 'F-2',
      summary: 'fix the cache',
      ref: 'def5678',
    }),
    line({
      base: BASE,
      minute: 7,
      kind: 'needs-owner',
      actor: 'pnt-ignis-1',
      flow: 'F-2',
      summary: 'permission_prompt',
    }),
    line({
      base: BASE,
      minute: 8,
      kind: 'flow',
      actor: 'hub-agent',
      flow: 'F-3',
      summary: 'Chọn cách phát hành',
      why: 'cần anh chọn một',
    }),
    line({
      base: BASE,
      minute: 9,
      kind: 'needs-owner',
      actor: 'hub-agent',
      flow: 'F-3',
      summary: 'Which way?',
    }),
    line({ base: BASE, minute: 10, kind: 'session-start', actor: 'worker-9', summary: 'startup' }),
    line({
      base: BASE,
      minute: 11,
      kind: 'subagent-stop',
      actor: 'worker-9',
      summary: 'Explore a1',
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
    sources: ['event log: 11 line(s)'],
  };
};

interface IRow {
  id: string;
  title: string;
  untitled: boolean;
  text: string;
}

interface IResult {
  hidden: IRow[];
  detailHidden: { heading: string; why: string | null; text: string };
  shown: IRow[];
  detailShown: string;
  pressed: string[];
  again: IRow[];
  vi: { label: string; untitled: string[] };
  errors: string[];
}

const EXPRESSION = `(async () => {
  localStorage.clear();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  const rows = () => [...document.querySelectorAll('.row')].map((r) => ({
    id: r.dataset.id,
    title: r.querySelector('.tt .t').textContent,
    untitled: !!r.querySelector('.untitled'),
    text: r.textContent,
  }));
  const open = async (id) => { document.querySelector('.row[data-id="' + id + '"]').click(); await wait(); };
  const out = { pressed: [], errors: window.__errs };
  // A page of an earlier test may have left the other language or the plumbing on in the saved choices.
  if (document.documentElement.lang !== 'en') { document.getElementById('bLang').click(); await wait(); }
  if (document.getElementById('bPlumb').getAttribute('aria-pressed') === 'true') { document.getElementById('bPlumb').click(); await wait(); }
  await wait();
  out.hidden = rows();
  await open('F-1');
  out.detailHidden = {
    heading: document.querySelector('#dBody h3').firstChild.textContent,
    why: document.querySelector('#dBody .why') ? document.querySelector('#dBody .why').textContent : null,
    text: document.getElementById('dBody').textContent,
  };
  out.pressed.push(document.getElementById('bPlumb').getAttribute('aria-pressed'));
  document.getElementById('bPlumb').click();
  await wait();
  out.pressed.push(document.getElementById('bPlumb').getAttribute('aria-pressed'));
  out.shown = rows();
  await open('F-1');
  out.detailShown = document.getElementById('dBody').textContent;
  document.getElementById('bPlumb').click();
  await wait();
  out.pressed.push(document.getElementById('bPlumb').getAttribute('aria-pressed'));
  out.again = rows();
  document.getElementById('bLang').click();
  await wait();
  out.vi = {
    label: document.getElementById('bPlumb').textContent.trim(),
    untitled: [...document.querySelectorAll('.row .untitled')].map((n) => n.textContent),
  };
  document.getElementById('bLang').click();
  await wait();
  return JSON.stringify(out);
})()`;

describe.skipIf(!hasBrowser)(
  'the board page: the title of a flow and the agent plumbing, in a real browser',
  () => {
    const html = BoardPage.render({ data: data() }).replace(
      '<script type="application/json"',
      '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
    );
    const run = async (dark: boolean): Promise<IResult> => {
      const raw = await BrowserPage.measure<string>({
        html,
        width: 1440,
        dark,
        expression: EXPRESSION,
      });

      return JSON.parse(raw) as IResult;
    };

    for (const dark of [false, true]) {
      test(`${dark ? 'dark' : 'light'}: plumbing is hidden until all events are asked for, then hidden again`, async () => {
        const result = await run(dark);

        expect(result.errors).toEqual([]);
        // By default: the three real flows; the plumbing-only flow is not a row; no plumbing in a flow's pane.
        expect(result.hidden.map((row) => row.id).sort()).toEqual(['F-1', 'F-2', 'F-3']);
        expect(result.detailHidden.text).not.toContain('turn ended');
        expect(result.detailHidden.text).not.toContain('idle_prompt');
        expect(result.detailHidden.text).not.toContain('agent activity');
        expect(result.hidden.find((row) => row.id === 'F-2')?.text).not.toContain(
          'permission_prompt',
        );
        // With all events: the plumbing-only flow is back, and so are the lines in the pane.
        expect(result.shown.map((row) => row.id).sort()).toEqual(['F-1', 'F-2', 'F-3', 'Unsorted']);
        expect(result.detailShown).toContain('turn ended');
        expect(result.detailShown).toContain('idle_prompt');
        expect(result.detailShown).toContain('agent activity');
        expect(result.pressed).toEqual(['false', 'true', 'false']);
        expect(result.again.map((row) => row.id).sort()).toEqual(['F-1', 'F-2', 'F-3']);
      });

      test(`${dark ? 'dark' : 'light'}: a flow shows its title and why; one without a title says so; a person's ask still counts`, async () => {
        const result = await run(dark);
        const row = (id: string): IRow => result.hidden.find((entry) => entry.id === id)!;

        expect(row('F-1')).toMatchObject({ title: 'Bảng việc cho anh', untitled: false });
        expect(row('F-3')).toMatchObject({ title: 'Chọn cách phát hành', untitled: false });
        // No name: today's heading (the first line's words), marked.
        expect(row('F-2')).toMatchObject({ title: 'fix the cache', untitled: true });
        expect(row('F-2').text).toContain('no title yet');
        expect(result.detailHidden.heading).toBe('Bảng việc cho anh');
        expect(result.detailHidden.why).toBe('để anh thấy việc nào chờ anh');
        // The message label is a line of the pane, not the heading.
        expect(result.detailHidden.text).toContain('status label');
        // Only the human ask makes a flow wait on the owner.
        expect(row('F-3').text).toContain('Which way?');
        expect(row('F-1').text).not.toContain('idle_prompt');
      });
    }

    test('Vietnamese: the toggle and the marker are translated', async () => {
      const result = await run(false);

      expect(result.vi.label).toBe('Hiện mọi sự kiện');
      expect(result.vi.untitled).toEqual(['chưa có tên']);
    });
  },
);
