import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const UI = join(import.meta.dir, '..', '..', '..', 'board', 'ui');
/** What puts text into the page as markup: any of these on event text would run it. */
const RAW_HTML =
  /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;

const sources = (opts: { folder: string }): string[] =>
  readdirSync(opts.folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources({ folder: join(opts.folder, entry.name) })
      : /\.(ts|tsx)$/.test(entry.name)
        ? [join(opts.folder, entry.name)]
        : [],
  );

describe('the board UI source', () => {
  test('no file puts text into the page as markup', () => {
    const files = sources({ folder: UI });

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(RAW_HTML.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });

  test('the guard catches each way of doing it', () => {
    for (const bad of [
      '<div dangerouslySetInnerHTML={{ __html: x }} />',
      'node.innerHTML = x',
      'node.outerHTML = x',
      "node.insertAdjacentHTML('beforeend', x)",
      'document.write(x)',
      'eval(x)',
      'new Function(x)',
    ]) {
      expect(RAW_HTML.test(bad), bad).toBe(true);
    }

    expect(RAW_HTML.test('<h1>{title}</h1>')).toBe(false);
  });
});
