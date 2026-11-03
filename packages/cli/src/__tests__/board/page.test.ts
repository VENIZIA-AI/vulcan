import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardPage } from '../../board/page.ts';
import { sampleData } from './sample-data.helper.ts';

const GOLDEN = join(import.meta.dir, 'golden', 'board-data.json');

const blockOf = (html: string): string =>
  /<script type="application\/json" id="board-data">(.*?)<\/script>/s.exec(html)?.[1] ?? '';

describe('BoardPage.render', () => {
  const html = BoardPage.render({ data: sampleData() });

  test('the data is one JSON block in the page, and it reads back as the data', () => {
    expect(html.match(/id="board-data"/g)).toHaveLength(1);
    expect(JSON.parse(blockOf(html))).toEqual(JSON.parse(JSON.stringify(sampleData())));
  });

  test('golden: the embedded data of the sample day is the file in golden/', () => {
    const actual = `${JSON.stringify(JSON.parse(blockOf(html)), null, 2)}\n`;

    if (!existsSync(GOLDEN) || process.env.VULCAN_UPDATE_GOLDEN === '1') {
      writeFileSync(GOLDEN, actual);
    }

    // Compared as data: the formatter may lay the file out again.
    expect(JSON.parse(actual)).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  test('text in the data cannot close the block or break the script', () => {
    const data = sampleData();

    data.flows[0].title = '</script><script>alert(1)</script>   <!--';

    const page = BoardPage.render({ data });

    expect(page).not.toContain('</script><script>alert(1)');
    expect(blockOf(page)).not.toContain('<');
    expect(blockOf(page)).not.toContain(' ');
    expect(JSON.parse(blockOf(page)).flows[0].title).toBe(data.flows[0].title);
  });

  test('the page is self-contained and read-only: no network, no claude.ai calls', () => {
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('claude.use(');
    expect(html).not.toContain('<!--BOARD_DATA-->');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});
