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

  test('the table: the code column fits the whole id, three digits or a long key, with the id as title, and a long holder leaves the columns fixed', async () => {
    const longIds = ['VULZ-BANA-140', 'VULZ-BANA-175', 'VULZ-VULCAN-1234'];
    const wide = {
      ...data,
      flows: data.flows.slice(0, longIds.length).map((flow, index) => ({
        ...flow,
        id: longIds[index] ?? flow.id,
      })),
    };
    const raw = await BrowserPage.measure<string>({
      html: BoardPage.render({ data: wide }),
      width: 1440,
      dark: false,
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        document.querySelector('[data-view="table"]').click();
        await wait();
        const cells = [...document.querySelectorAll('.t-work td.c-id')];
        const holder = document.querySelector('.t-work th:nth-child(5)');
        const before = holder.getBoundingClientRect().width;
        document.querySelector('.t-work tbody tr td:nth-child(5)').append(' a-holder-name-much-longer-than-its-column-can-show');
        await wait();
        const holderKept = holder.getBoundingClientRect().width === before;
        localStorage.clear();
        return JSON.stringify({ holderKept, cells: cells.map((cell) => ({
          text: cell.textContent,
          title: cell.title,
          clipped: cell.scrollWidth > cell.clientWidth,
        })) });
      })()`,
    });
    const {
      cells,
      holderKept,
    }: {
      cells: { text: string; title: string; clipped: boolean }[];
      holderKept: boolean;
    } = JSON.parse(raw);

    expect(cells.length).toBe(longIds.length);
    expect(holderKept).toBe(true);

    for (const cell of cells) {
      expect(longIds).toContain(cell.text);
      expect(cell.title).toBe(cell.text);
      expect(cell.clipped).toBe(false);
    }
  });

  test('the table: eleven columns in order, a header click sorts with aria-sort, and j moves through its rows', async () => {
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
      'Order',
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

  test('390px: one bar line with the secondary controls in a menu, and the filters in one button that opens a sheet', async () => {
    const result = await run<{
      barHeight: number;
      toolsShown: boolean;
      menuShown: boolean;
      pillsShown: boolean;
      sheetShown: boolean;
      sheetBottom: number;
      innerHeight: number;
      states: string[];
      errors: string[];
    }>({
      width: 390,
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        const shown = (node) => node !== null && getComputedStyle(node).display !== 'none';
        const tools = document.querySelector('.bar .tools');
        const out = { barHeight: document.querySelector('header.bar').getBoundingClientRect().height, toolsShown: shown(tools) };
        document.querySelector('.ib.more').click();
        await wait();
        out.menuShown = shown(tools);
        document.querySelector('.ib.more').click();
        await wait();
        out.pillsShown = shown(document.querySelector('.c-tools'));
        document.querySelector('.f-btn').click();
        await wait();
        const sheet = document.querySelector('.c-tools');
        out.sheetShown = shown(sheet);
        out.sheetBottom = Math.round(sheet.getBoundingClientRect().bottom);
        out.innerHeight = innerHeight;
        document.querySelector('.scrim').click();
        await wait();
        out.states = [...document.querySelectorAll('#groups .c-gh .sm')].map((mark) => mark.getAttribute('class'));
        out.errors = window.__errs;
        localStorage.clear();
        return JSON.stringify(out);
      })()`,
    });

    expect(result.errors).toEqual([]);
    expect(result.barHeight).toBeLessThanOrEqual(56);
    expect(result.toolsShown).toBe(false);
    expect(result.menuShown).toBe(true);
    expect(result.pillsShown).toBe(false);
    expect(result.sheetShown).toBe(true);
    expect(result.sheetBottom).toBe(result.innerHeight);
    expect(result.states).toEqual([
      'sm s-you',
      'sm s-blocked',
      'sm s-running',
      'sm s-parked',
      'sm s-done',
    ]);
  });

  test('the table sort is kept: across a reload, a switch of view and an empty list; a third click goes back to the default', async () => {
    await run({ expression: `(() => { localStorage.clear(); return '{}'; })()` });

    const first = await run<{ sort: string | null; stored: string | null; selectedAttr: number }>({
      expression: `(async () => {
        ${WAIT}
        document.querySelector('[data-view="table"]').click();
        await wait();
        document.querySelector('[data-column="code"]').click();
        await wait();
        document.querySelector('tbody tr.row').click();
        await wait();
        return JSON.stringify({
          sort: document.querySelector('th:has([data-column="code"])').getAttribute('aria-sort'),
          stored: localStorage.getItem('board:acme:sort'),
          selectedAttr: document.querySelectorAll('tbody tr[aria-selected]').length,
        });
      })()`,
    });
    const after = await run<{
      reloaded: string | null;
      afterViews: string | null;
      afterEmpty: string | null;
      third: string | null;
      stored: string | null;
    }>({
      expression: `(async () => {
        ${WAIT}
        const sortOf = () => document.querySelector('th:has([data-column="code"])')?.getAttribute('aria-sort') ?? null;
        const out = { reloaded: sortOf() };
        document.querySelector('[data-view="cards"]').click();
        await wait();
        document.querySelector('[data-view="table"]').click();
        await wait();
        out.afterViews = sortOf();
        const stale = document.querySelector('.stale-pill');
        stale.click();
        await wait();
        const state = [...document.querySelectorAll('.c-field')].find((field) => /State/.test(field.textContent)).querySelector('select');
        state.value = 'parked';
        state.dispatchEvent(new Event('change', { bubbles: true }));
        await wait();
        [...document.querySelectorAll('.c-tools button')].find((button) => /Clear/.test(button.textContent)).click();
        await wait();
        out.afterEmpty = sortOf();
        document.querySelector('[data-column="code"]').click();
        await wait();
        document.querySelector('[data-column="code"]').click();
        await wait();
        out.third = sortOf();
        out.stored = localStorage.getItem('board:acme:sort');
        localStorage.clear();
        return JSON.stringify(out);
      })()`,
    });

    expect(first).toEqual({ sort: 'ascending', stored: 'code:asc', selectedAttr: 0 });
    expect(after).toEqual({
      reloaded: 'ascending',
      afterViews: 'ascending',
      afterEmpty: 'ascending',
      third: null,
      stored: 'default',
    });
  });

  test('390px: Esc closes the menu and the filter sheet and gives the focus back; the sheet takes the focus and keeps Tab inside', async () => {
    const result = await run<Record<string, unknown>>({
      width: 390,
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        const shown = (node) => getComputedStyle(node).display !== 'none';
        const esc = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const tab = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        const out = {};
        const more = document.querySelector('.ib.more');
        more.click();
        await wait();
        out.menuFocus = document.querySelector('.bar .tools').contains(document.activeElement);
        esc();
        await wait();
        out.menuClosed = !shown(document.querySelector('.bar .tools'));
        out.menuFocusBack = document.activeElement === more;
        more.click();
        await wait();
        document.getElementById('bLang').click();
        await wait();
        out.menuClosedOnChoice = !shown(document.querySelector('.bar .tools'));
        document.getElementById('bLang').click();
        await wait();
        document.querySelector('#groups .row').click();
        await wait();
        const button = document.querySelector('.f-btn');
        button.click();
        await wait();
        const sheet = document.querySelector('.c-tools');
        out.role = sheet.getAttribute('role');
        out.modal = sheet.getAttribute('aria-modal');
        out.sheetFocus = sheet.contains(document.activeElement);
        const controls = [...sheet.querySelectorAll('button, select')].filter((node) => node.offsetParent !== null);
        controls.at(-1).focus();
        tab();
        await wait();
        out.tabWraps = document.activeElement === controls[0];
        esc();
        await wait();
        out.sheetClosed = !shown(sheet);
        out.sheetFocusBack = document.activeElement === button;
        out.detailStillOpen = !document.getElementById('detail').hidden;
        out.errors = window.__errs;
        localStorage.clear();
        return JSON.stringify(out);
      })()`,
    });

    expect(result).toEqual({
      menuFocus: true,
      menuClosed: true,
      menuFocusBack: true,
      menuClosedOnChoice: true,
      role: 'dialog',
      modal: 'true',
      sheetFocus: true,
      tabWraps: true,
      sheetClosed: true,
      sheetFocusBack: true,
      detailStillOpen: true,
      errors: [],
    });
  });

  test('700px: the filter panel closes on a press outside it', async () => {
    const result = await run<{ opened: boolean; closed: boolean; modal: string | null }>({
      width: 700,
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        const sheet = document.querySelector('.c-tools');
        document.querySelector('.f-btn').click();
        await wait();
        const opened = getComputedStyle(sheet).display !== 'none';
        const modal = sheet.getAttribute('aria-modal');
        document.querySelector('#groups').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await wait();
        return JSON.stringify({ opened, modal, closed: getComputedStyle(sheet).display === 'none' });
      })()`,
    });

    expect(result).toEqual({ opened: true, modal: null, closed: true });
  });

  test('a flow of plumbing only, shown with all events, says when it moved and never NaN', async () => {
    const quiet = structuredClone(data);
    const base = quiet.flows.find((flow) => flow.id !== 'Unsorted');

    if (base === undefined) {
      throw new Error('the sample has no flow');
    }

    quiet.flows.push({
      ...base,
      id: 'F-90',
      title: 'Only plumbing',
      state: 'running',
      steps: undefined,
      events: base.events
        .slice(0, 1)
        .map((event) => ({ ...event, id: 'p-1', flowId: 'F-90', plumbing: true })),
      lastId: 'p-1',
    });

    const page = BoardPage.render({ data: quiet });
    const raw = await BrowserPage.measure<string>({
      html: page,
      width: 1440,
      dark: false,
      expression: `(async () => {
        localStorage.clear();
        ${WAIT}
        document.getElementById('bPlumb').click();
        await wait();
        const out = {};
        for (const view of ['compact', 'table']) {
          document.querySelector('[data-view="' + view + '"]').click();
          await wait();
          const row = document.querySelector('[data-id="F-90"]');
          out[view] = { text: row ? row.textContent : null, empty: document.querySelectorAll('time[datetime=""]').length };
        }
        localStorage.clear();
        return JSON.stringify(out);
      })()`,
    });
    const result: Record<string, { text: string | null; empty: number }> = JSON.parse(raw);

    for (const view of ['compact', 'table']) {
      expect(result[view].text, view).toContain('Only plumbing');
      expect(result[view].text, view).not.toContain('NaN');
      expect(result[view].empty, view).toBe(0);
    }
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
