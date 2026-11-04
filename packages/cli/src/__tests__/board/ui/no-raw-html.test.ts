import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const UI = join(import.meta.dir, '..', '..', '..', 'board', 'ui');
/** What puts text into the page as markup or as code: any of these on event text would run it. */
const RAW_HTML =
  /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|setHTMLUnsafe|srcDoc|createContextualFragment|parseFromString|document\.write|\beval\s*\(|\bFunction\s*\(/;
/**
 * A link or a source built from data: Preact, unlike React 19, lets a `javascript:` address through. The value of
 * these attributes is a text or goes through `BoardUrl.safe`, which lets only an `https://` address pass.
 */
const UNSAFE_URL = /\b(?:href|src|action|formAction|xlinkHref)\s*=\s*\{(?!\s*BoardUrl\.safe\()/;

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

  test('no link or source takes data that did not go through BoardUrl.safe', () => {
    for (const file of sources({ folder: UI })) {
      expect(UNSAFE_URL.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });

  test('the url guard catches data in a link and lets a checked one and a text pass', () => {
    for (const bad of [
      '<a href={link}>',
      '<a href = {pr.link}>',
      '<img src={x} />',
      '<form action={x}>',
    ]) {
      expect(UNSAFE_URL.test(bad), bad).toBe(true);
    }

    for (const good of [
      '<a href={BoardUrl.safe({ value: link })}>',
      '<a href={ BoardUrl.safe({ value: link }) }>',
      '<a href="https://x.example">',
    ]) {
      expect(UNSAFE_URL.test(good), good).toBe(false);
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
      'eval (x)',
      'new Function(x)',
      'new Function (x)',
      'Function(x)()',
      '<iframe srcDoc={x} />',
      'node.setHTMLUnsafe(x)',
      'range.createContextualFragment(x)',
      'new DOMParser().parseFromString(x, "text/html")',
    ]) {
      expect(RAW_HTML.test(bad), bad).toBe(true);
    }

    expect(RAW_HTML.test('<h1>{title}</h1>')).toBe(false);
  });
});
