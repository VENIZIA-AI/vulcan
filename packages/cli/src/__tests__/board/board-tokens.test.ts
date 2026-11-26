import { afterAll, describe, expect, test } from 'bun:test';
import { BoardFold } from '../../board/fold.ts';
import { BoardPage } from '../../board/page.ts';
import { BoardTokens } from '../../board/tokens.ts';
import type { IBoardData } from '../../board/common/index.ts';
import { EventLog } from '../../events/index.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { line } from './log-lines.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const BASE = Date.now() - 60 * 60_000;
const usage = (opts: { flow?: string; actor: string; agent?: string; out: number }) =>
  EventLog.build({
    type: 'usage',
    summary: 'tokens',
    actor: opts.actor,
    source: 'claude-hook',
    ...(opts.flow === undefined ? {} : { flowId: opts.flow }),
    usage: {
      model: 'claude-sonnet-5-5',
      ...(opts.agent === undefined ? {} : { agent: opts.agent }),
      input: 12,
      output: opts.out,
      cacheRead: 1_234_567,
      cacheWrite: 89,
    },
    mark: { offset: 1 },
    now: BASE + 5 * 60_000,
  });

const data = (): IBoardData => {
  const lines = [
    line({ base: BASE, minute: 1, kind: 'flow', actor: 'lead', flow: 'F-1', summary: 'Sign in' }),
    line({
      base: BASE,
      minute: 2,
      kind: 'commit',
      actor: 'lead',
      flow: 'F-1',
      summary: 'the lock',
    }),
    usage({ flow: 'F-1', actor: 'lead', out: 4210 }),
    usage({ flow: 'F-1', actor: 'lead', agent: 'Explore', out: 90 }),
    usage({ actor: 'lead', out: 7 }),
  ];
  const log = BoardFold.fromLog({ events: lines });
  const tokens = log.tokens;
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: 'Ana' });

  return {
    title: 'Acme Board',
    owner: 'Ana',
    key: 'acme',
    shapes: {},
    generatedAt: new Date(BASE + 70 * 60_000).toISOString(),
    since: new Date(BASE - 60_000).toISOString(),
    flows: flows.map((flow) =>
      tokens[flow.id] === undefined ? flow : { ...flow, tokens: tokens[flow.id] },
    ),
    decisions,
    agents: log.agents,
    sources: [],
  };
};

const EXPRESSION = `(async () => {
  localStorage.clear();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  const out = { errors: window.__errs };
  if (document.documentElement.lang !== 'en') { document.getElementById('bLang').click(); await wait(); }
  document.querySelector('.row[data-id="F-1"]').click();
  await wait();
  const texts = (selector) => [...document.querySelectorAll(selector)].map((c) => c.textContent);
  const table = document.querySelector('.d-tokens');
  out.heading = table.closest('.d-sec').querySelector('h3').textContent;
  out.head = texts('.d-tokens thead th');
  out.rows = [...table.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => [...c.childNodes].map((n) => n.textContent).join(' | ')));
  const fields = document.querySelector('.d-fields');
  out.fieldsOpen = fields.open;
  out.note = fields.querySelector('p').textContent;
  out.fields = [...fields.querySelector('dl').children].map((c) => c.textContent);
  document.getElementById('bLang').click();
  await wait();
  out.vi = {
    heading: document.querySelector('.d-tokens').closest('.d-sec').querySelector('h3').textContent,
    head: texts('.d-tokens thead th'),
    share: document.querySelector('.d-tokens tbody small').textContent,
    summary: document.querySelector('.d-fields summary').textContent,
  };
  document.getElementById('bLang').click();
  await wait();
  // A page of an earlier test may have left the plumbing on in the saved choices: it is made visible, not toggled.
  if (document.getElementById('bPlumb').getAttribute('aria-pressed') !== 'true') { document.getElementById('bPlumb').click(); await wait(); }
  document.querySelector('.c-loose').click();
  await wait();
  out.loose = document.querySelector('.d-tokens') ? document.querySelector('.d-tokens').textContent : null;
  return JSON.stringify(out);
})()`;

describe('the tokens of a flow in the data', () => {
  test('a flow carries its totals, and the lines of no flow are summed apart', () => {
    const found = data();
    const flow = found.flows.find((item) => item.id === 'F-1');

    expect(flow?.tokens).toMatchObject({
      input: 24,
      output: 4300,
      cacheRead: 2_469_134,
      cacheWrite: 178,
    });
    expect(flow?.tokens?.agents.map((row) => row.name)).toEqual(['lead', 'lead (Explore)']);
    expect(BoardTokens.of({ events: [], unflowed: 'Unsorted' })).toEqual({});
    expect(JSON.stringify(found)).not.toMatch(/price|cost|usd|dollar|money/i);
  });
});

describe.skipIf(!hasBrowser)('the tokens block of the board page, in a real browser', () => {
  const html = BoardPage.render({ data: data() }).replace(
    '<script type="application/json"',
    '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
  );

  for (const dark of [false, true]) {
    test(`${dark ? 'dark' : 'light'}: totals, the agents and the words in both languages, no money`, async () => {
      const result2 = await BrowserPage.measure<string>({
        html,
        width: 1440,
        dark,
        expression: EXPRESSION,
      });
      const result = JSON.parse(result2) as {
        errors: string[];
        heading: string;
        head: string[];
        rows: string[][];
        fieldsOpen: boolean;
        note: string;
        fields: string[];
        vi: { heading: string; head: string[]; share: string; summary: string };
        loose: string | null;
      };

      expect(result.errors).toEqual([]);
      expect(result.heading).toBe('Tokens');
      expect(result.head).toEqual(['', 'Read', 'Written']);
      expect(result.rows[0]).toEqual(['All agents', '2,469,336 | 99% from cache', '4,300']);
      expect(result.fieldsOpen).toBe(false);
      expect(result.note).toBe('input_tokens counts only the part outside the cache.');
      expect(result.fields).toEqual([
        'input_tokens',
        '24',
        'cache_read_input_tokens',
        '2,469,134',
        'cache_creation_input_tokens',
        '178',
        'output_tokens',
        '4,300',
      ]);
      expect(result.rows.map((row) => row[0])).toEqual(['All agents', 'lead', 'lead (Explore)']);
      expect(result.vi.heading).toBe('Token');
      expect(result.vi.head).toEqual(['', 'Đọc vào', 'Viết ra']);
      expect(result.vi.share).toBe('99% từ cache');
      expect(result.vi.summary).toBe('Các trường API');
      expect(result.loose).toContain('7');
      expect(JSON.stringify(result)).not.toMatch(/price|cost|usd|\$|money/i);
    });
  }
});
