import { describe, expect, test } from 'bun:test';
import { escapeAttribute, escapeHtml } from '../../viz/client/html.ts';
import { renderMarkdown } from '../../viz/client/markdown.ts';

describe('escapeHtml', () => {
  test('escapes the three characters that open markup', () => {
    expect(escapeHtml({ text: '<a href="x">&</a>' })).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });

  test('escapeAttribute also escapes the double quote', () => {
    expect(escapeAttribute({ text: 'a"b' })).toBe('a&quot;b');
  });
});

describe('renderMarkdown', () => {
  test('a paragraph is escaped, never interpreted', () => {
    expect(renderMarkdown({ source: 'a <b>bold</b> claim' })).toBe(
      '<p>a &lt;b&gt;bold&lt;/b&gt; claim</p>',
    );
  });

  test('every heading level renders as h2', () => {
    expect(renderMarkdown({ source: '# One\n### Three' })).toBe('<h2>One</h2><h2>Three</h2>');
  });

  test('a fenced block is escaped verbatim, without inline formatting', () => {
    expect(renderMarkdown({ source: '```ts\nconst a = `x` < 1;\n**not bold**\n```' })).toBe(
      '<pre><code>const a = `x` &lt; 1;\n**not bold**\n</code></pre>',
    );
  });

  test('a table needs its separator row', () => {
    const html = renderMarkdown({ source: '| A | B |\n|---|---|\n| 1 | `2` |' });

    expect(html).toBe(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table>',
    );
  });

  test('a pipe row without a separator stays a paragraph', () => {
    expect(renderMarkdown({ source: '| A | B |' })).toBe('<p>| A | B |</p>');
  });

  test('a list closes before the next paragraph', () => {
    expect(renderMarkdown({ source: '- one\n* two\nafter' })).toBe(
      '<ul><li>one</li><li>two</li></ul><p>after</p>',
    );
  });

  test('a concept link becomes an in-page link; other links stay text', () => {
    expect(
      renderMarkdown({ source: 'see [DI](/architecture/di.md) and [web](https://x.dev)' }),
    ).toBe('<p>see <a data-go="/architecture/di">DI</a> and [web](https://x.dev)</p>');
  });

  test('inline code and bold', () => {
    expect(renderMarkdown({ source: 'use `make` **now**' })).toBe(
      '<p>use <code>make</code> <strong>now</strong></p>',
    );
  });

  test('consecutive lines form one paragraph; a blank line ends it', () => {
    expect(renderMarkdown({ source: 'a wrapped\nsentence\n\nnext' })).toBe(
      '<p>a wrapped sentence</p><p>next</p>',
    );
  });

  test('an indented line continues the list item above it', () => {
    expect(renderMarkdown({ source: '- one\n  two\n- three' })).toBe(
      '<ul><li>one two</li><li>three</li></ul>',
    );
  });

  test('single asterisks are emphasis, double are strong', () => {
    expect(renderMarkdown({ source: 'it *is* **a** container' })).toBe(
      '<p>it <em>is</em> <strong>a</strong> container</p>',
    );
  });

  test('a blockquote line', () => {
    expect(renderMarkdown({ source: '> careful' })).toBe('<blockquote>careful</blockquote>');
  });
});

describe('link targets', () => {
  test('a quote in a concept link target cannot break out of the data-go attribute', () => {
    const html = renderMarkdown({ source: '[x](/a" onmouseover="steal.md)' });

    expect(html).not.toContain('" onmouseover="');
    expect(html).toContain('data-go="/a&quot; onmouseover=&quot;steal"');
  });
});
