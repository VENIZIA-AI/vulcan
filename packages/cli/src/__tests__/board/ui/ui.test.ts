import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BoardPage } from '../../../board/page.ts';
import { BoardUiBuild } from '../../../../../../scripts/board-ui/build.ts';
import { BrowserPage } from '../../visualize/browser.helper.ts';
import { sampleData } from '../sample-data.helper.ts';

const ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..');
const hasBrowser = await BrowserPage.available();
const PROBE = 'packages/cli/src/__tests__/board/ui/compat-probe.tsx';

afterAll(() => BrowserPage.close());

const withErrors = (page: string): string =>
  page.replace(
    '<script>',
    '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message));</script><script>',
  );

describe.skipIf(!hasBrowser)('the board page built from components, in a real browser', () => {
  test('it shows the title from the data block, as text, with no script error', async () => {
    const template = await BoardUiBuild.build({ root: ROOT });
    const hostile = '</script><script>window.__ran=1</script><b>x</b>';
    const html = withErrors(
      BoardPage.render({ data: { ...sampleData(), title: hostile }, template }),
    );
    const raw = await BrowserPage.measure<string>({
      html,
      width: 1440,
      dark: false,
      expression: `JSON.stringify({
        title: document.getElementById('boardTitle').textContent,
        scripts: document.querySelectorAll('script').length,
        ran: window.__ran === 1,
        bold: document.querySelectorAll('#boardTitle b').length,
        errors: window.__errs,
      })`,
    });
    const seen: { title: string; scripts: number; ran: boolean; bold: number; errors: string[] } =
      JSON.parse(raw);

    expect(seen.title).toBe(hostile);
    expect(seen.ran).toBe(false);
    expect(seen.bold).toBe(0);
    expect(seen.errors).toEqual([]);
  });

  test('the preact alias keeps what the page will rely on: onChange, useId, useRef, ref callbacks and keys', async () => {
    const { text: script } = await BoardUiBuild.bundle({ root: ROOT, entry: PROBE });
    const html = withErrors(
      `<!doctype html><body><div id="root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body>`,
    );
    const raw = await BrowserPage.measure<string>({
      html,
      width: 800,
      dark: false,
      expression: `(async () => {
        const wait = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 20)));
        const one = document.querySelector('[data-field="one"]');
        one.value = 'typed';
        one.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        const before = [...document.querySelectorAll('[data-item]')].map((node) => node);
        document.querySelector('[data-action="reverse"]').click();
        await wait();
        const after = [...document.querySelectorAll('[data-item]')];
        const ids = [...document.querySelectorAll('[data-id]')].map((node) => node.dataset.id);
        return JSON.stringify({
          mirrorOne: document.querySelector('[data-mirror="one"]').textContent,
          mirrorTwo: document.querySelector('[data-mirror="two"]').textContent,
          ids,
          idsDiffer: new Set(ids).size === 2 && ids.every((id) => id && id.length > 0),
          order: after.map((node) => node.dataset.item),
          sameNodes: after.every((node) => before.includes(node)),
          refCallback: after.every((node) => node.dataset.ref === 'set'),
          seen: document.querySelector('[data-seen]').textContent,
          errors: window.__errs,
        });
      })()`,
    });
    const seen: {
      mirrorOne: string;
      mirrorTwo: string;
      idsDiffer: boolean;
      order: string[];
      sameNodes: boolean;
      refCallback: boolean;
      seen: string;
      errors: string[];
    } = JSON.parse(raw);

    expect(seen.mirrorOne, 'onChange did not fire on input').toBe('typed');
    expect(seen.mirrorTwo, 'two fields share state').toBe('');
    expect(seen.idsDiffer, 'useId gave the same id twice').toBe(true);
    expect(seen.order).toEqual(['c', 'b', 'a']);
    expect(seen.sameNodes, 'a keyed item was recreated, not moved').toBe(true);
    expect(seen.refCallback).toBe(true);
    expect(seen.seen, 'useRef did not hold the node').toBe('UL');
    expect(seen.errors).toEqual([]);
  });
});
