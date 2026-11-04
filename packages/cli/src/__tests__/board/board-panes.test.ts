import { afterAll, describe, expect, test } from 'bun:test';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const DAY = 24 * 60 * 60 * 1000;

/** The local calendar day `offset` days from now, as YYYY-MM-DD. */
const dayOf = (offset: number): string => {
  const date = new Date(Date.now() + offset * DAY);
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const page = (): { html: string; ids: string[] } => {
  const data = sampleData({ base: Date.now() - 100 * 60_000 });
  const work = data.flows.filter((flow) => flow.id !== 'Unsorted');
  const ids = work.map((flow) => flow.id);

  Object.assign(work[0], { due: dayOf(-1) });
  Object.assign(work[1], { due: dayOf(2) });
  Object.assign(work[2], { due: dayOf(30) });

  return {
    html: BoardPage.render({ data }).replace(
      '<script type="application/json"',
      '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
    ),
    ids,
  };
};

interface IPanes {
  due: Record<string, { text: string; tone: string }>;
  closedAtStart: boolean;
  afterAgent: { detail: string; shown: string[]; picked: string[] };
  afterAgainAgent: { shown: number; closed: boolean };
  afterFlow: { closed: boolean; title: string };
  afterX: boolean;
  afterEsc: boolean;
  errors: string[];
}

const EXPRESSION = `(async () => {
  localStorage.clear();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  const detail = document.getElementById('detail');
  const open = () => !detail.hidden && getComputedStyle(detail).display !== 'none';
  const ids = () => [...document.querySelectorAll('#groups .row')].map((row) => row.dataset.id);
  document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
  await wait();
  const out = { errors: window.__errs, due: {} };
  for (const row of document.querySelectorAll('#groups .row')) {
    const badge = [...row.querySelectorAll('.c-badge')].find((one) => /Due|Hạn/.test(one.textContent));
    if (badge) out.due[row.dataset.id] = { text: badge.textContent, tone: badge.className.replace('c-badge ', '') };
  }
  out.closedAtStart = !open();
  const total = ids().length;
  const agent = document.querySelector('#dock [data-agent]');
  agent.click();
  await wait();
  out.afterAgent = {
    detail: document.querySelector('#dBody h2').textContent,
    shown: ids(),
    picked: [...document.querySelectorAll('#dock [data-agent].on, #dock [data-agent][aria-pressed="true"]')].map((one) => one.dataset.agent),
    total,
    name: agent.dataset.agent,
  };
  document.querySelector('#dock [data-agent="' + agent.dataset.agent + '"]').click();
  await wait();
  out.afterAgainAgent = { shown: ids().length, closed: !open(), total };
  document.querySelector('#groups .row').click();
  await wait();
  out.afterFlow = { closed: !open(), title: document.querySelector('#dBody h2').textContent };
  document.querySelector('.c-x').click();
  await wait();
  out.afterX = !open();
  document.querySelector('#groups .row').click();
  await wait();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait();
  out.afterEsc = !open();
  return JSON.stringify(out);
})()`;

describe.skipIf(!hasBrowser)(
  'the three panes: due badges, picking an agent, closing the detail',
  () => {
    const { html, ids } = page();
    const run = async (
      width: number,
    ): Promise<IPanes & { afterAgent: { total: number; name: string } }> => {
      const raw = await BrowserPage.measure<string>({
        html,
        width,
        dark: false,
        expression: EXPRESSION,
      });

      return JSON.parse(raw);
    };

    for (const width of [1440, 390]) {
      test(`${width}px: a due day inside two days is red, a far one is quiet, an overdue one says so`, async () => {
        const result = await run(width);

        expect(result.errors).toEqual([]);
        expect(result.due[ids[0]].text).toContain(dayOf(-1));
        expect(result.due[ids[0]].text).toContain('overdue');
        expect(result.due[ids[0]].tone).toBe('b-ask');
        expect(result.due[ids[1]].text).toContain('2 days left');
        expect(result.due[ids[1]].tone).toBe('b-ask');
        expect(result.due[ids[2]].text).toContain('30 days left');
        expect(result.due[ids[2]].tone).toBe('b-idle');
      });

      test(`${width}px: the detail is closed until something is picked; an agent narrows the list and picking it again undoes both`, async () => {
        const result = await run(width);

        expect(result.closedAtStart).toBe(true);
        expect(result.afterAgent.detail).toBe(result.afterAgent.name);
        expect(result.afterAgent.shown.length).toBeLessThan(result.afterAgent.total);
        expect(result.afterAgent.shown.length).toBeGreaterThan(0);
        expect(result.afterAgainAgent.shown).toBe(result.afterAgent.total);
        expect(result.afterAgainAgent.closed).toBe(true);
      });

      test(`${width}px: a flow opens the detail; the cross and Escape close it`, async () => {
        const result = await run(width);

        expect(result.afterFlow.closed).toBe(false);
        expect(result.afterFlow.title.length).toBeGreaterThan(0);
        expect(result.afterX).toBe(true);
        expect(result.afterEsc).toBe(true);
      });
    }
  },
);
