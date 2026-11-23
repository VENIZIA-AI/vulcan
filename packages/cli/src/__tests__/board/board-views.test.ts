import { afterAll, describe, expect, test } from 'bun:test';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const data = sampleData({ base: Date.now() - 100 * 60_000 });
const RUNNING = data.flows.filter(
  (flow) => flow.state === 'running' && flow.id !== 'Unsorted',
).length;
const html = BoardPage.render({ data }).replace(
  '<script type="application/json"',
  '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
);
const WAIT = 'const wait = () => new Promise((resolve) => setTimeout(resolve, 80));';
const run = async <TResult>(opts: { expression: string; width?: number }): Promise<TResult> => {
  const raw = await BrowserPage.measure<string>({
    html,
    width: opts.width ?? 1440,
    dark: false,
    expression: opts.expression,
  });

  return JSON.parse(raw);
};

describe.skipIf(!hasBrowser)('the work items as cards, compact lines or a table', () => {
  test('the view is kept per viewer: compact after a reload, and c switches compact and cards', async () => {
    await run({ expression: `(() => { localStorage.clear(); return '{}'; })()` });

    const first = await run<{
      pressed: string;
      lines: number;
      cards: number;
      stored: string | null;
    }>({
      expression: `(async () => {
        ${WAIT}
        document.querySelector('[data-view="compact"]').click();
        await wait();
        document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
        await wait();
        return JSON.stringify({
          pressed: document.querySelector('[data-view][aria-pressed="true"]').dataset.view,
          lines: document.querySelectorAll('#groups .c-line').length,
          cards: document.querySelectorAll('#groups .c-card').length,
          stored: localStorage.getItem('board:acme:view'),
        });
      })()`,
    });
    const reloaded = await run<{
      pressed: string;
      afterKey: string;
      afterKeyAgain: string;
      errors: string[];
    }>({
      expression: `(async () => {
        ${WAIT}
        const pressed = document.querySelector('[data-view][aria-pressed="true"]').dataset.view;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
        await wait();
        const afterKey = document.querySelector('[data-view][aria-pressed="true"]').dataset.view;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
        await wait();
        const afterKeyAgain = document.querySelector('[data-view][aria-pressed="true"]').dataset.view;
        localStorage.clear();
        return JSON.stringify({ pressed, afterKey, afterKeyAgain, errors: window.__errs });
      })()`,
    });

    expect(first).toEqual({ pressed: 'compact', lines: 5, cards: 0, stored: 'compact' });
    expect(reloaded).toEqual({
      pressed: 'compact',
      afterKey: 'cards',
      afterKeyAgain: 'compact',
      errors: [],
    });
  });

  test('the table: ten columns in order, a header click sorts with aria-sort, and j moves through its rows', async () => {
    const result = await run<{
      headers: string[];
      rows: number;
      before: string | null;
      asc: { sort: string | null; ids: string[] };
      desc: { sort: string | null; ids: string[] };
      picked: string;
      title: string;
      errors: string[];
    }>({
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        document.querySelector('[data-view="table"]').click();
        await wait();
        const header = () => document.querySelector('th:has([data-column="code"])');
        const ids = () => [...document.querySelectorAll('tbody tr.row')].map((row) => row.dataset.id);
        const out = {
          headers: [...document.querySelectorAll('.t-work th')].map((th) => th.textContent),
          rows: ids().length,
          before: header().getAttribute('aria-sort'),
        };
        document.querySelector('[data-column="code"]').click();
        await wait();
        out.asc = { sort: header().getAttribute('aria-sort'), ids: ids() };
        document.querySelector('[data-column="code"]').click();
        await wait();
        out.desc = { sort: header().getAttribute('aria-sort'), ids: ids() };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
        await wait();
        out.picked = document.activeElement.dataset.id;
        out.title = document.querySelector('#dBody h2').textContent;
        out.errors = window.__errs;
        localStorage.clear();
        return JSON.stringify(out);
      })()`,
    });

    expect(result.errors).toEqual([]);
    expect(result.headers).toEqual([
      'Code',
      'Title',
      'Stage',
      'State',
      'Holder',
      'Steps',
      'PR · CI',
      'Tokens',
      'Due',
      'Last update',
    ]);
    expect(result.rows).toBe(5);
    expect(result.before).toBeNull();
    expect(result.asc.sort).toBe('ascending');
    expect(result.desc.sort).toBe('descending');
    expect(result.asc.ids).toEqual(
      [...result.asc.ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    );
    expect(result.desc.ids).toEqual([...result.asc.ids].reverse());
    expect(result.picked).toBe(result.desc.ids[0]);
    expect(result.title.length).toBeGreaterThan(0);
  });

  test('the filters narrow every view the same way, and clear again', async () => {
    const result = await run<{
      all: number;
      running: number;
      tableRunning: number;
      cleared: number;
      count: string;
    }>({
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        document.querySelectorAll('.c-gh[aria-expanded="false"]').forEach((button) => button.click());
        await wait();
        const all = document.querySelectorAll('#groups .row').length;
        const select = [...document.querySelectorAll('.c-field')].find((field) => /State/.test(field.textContent)).querySelector('select');
        select.value = 'running';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await wait();
        const running = document.querySelectorAll('#groups .row').length;
        const count = document.getElementById('flowN').textContent;
        document.querySelector('[data-view="table"]').click();
        await wait();
        const tableRunning = document.querySelectorAll('tbody tr.row').length;
        [...document.querySelectorAll('.c-tools button')].find((button) => /Clear/.test(button.textContent)).click();
        await wait();
        const cleared = document.querySelectorAll('tbody tr.row').length;
        localStorage.clear();
        return JSON.stringify({ all, running, tableRunning, cleared, count });
      })()`,
    });

    expect(result.all).toBe(5);
    expect(RUNNING).toBeGreaterThan(1);
    expect(result.running).toBe(RUNNING);
    expect(result.count).toBe(String(RUNNING));
    expect(result.tableRunning).toBe(RUNNING);
    expect(result.cleared).toBe(5);
  });

  for (const width of [1440, 390]) {
    test(`${width}px: no view scrolls the page sideways`, async () => {
      const result = await run<Record<string, number>>({
        width,
        expression: `(async () => {
          localStorage.clear();
          ${WAIT}
          const out = {};
          for (const view of ['cards', 'compact', 'table']) {
            document.querySelector('[data-view="' + view + '"]').click();
            await wait();
            out[view] = document.documentElement.scrollWidth;
          }
          localStorage.clear();
          return JSON.stringify(out);
        })()`,
      });

      expect(Math.max(...Object.values(result))).toBeLessThanOrEqual(width + 1);
    });
  }
});
