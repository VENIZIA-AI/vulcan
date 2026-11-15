import { describe, expect, test } from 'bun:test';
import {
  SECTION_NAMES,
  countSections,
  firstSentence,
  parseItems,
  renderInline,
  renderParagraphs,
  shortPackage,
} from '../../../docs/wiki/site/.vitepress/theme/shared/changelog-items.ts';

const LOG = `---
title: 0.4.8
version: 0.4.8
packages: ['@a/kernel', '@a/web']
---
This release does things. It also does others.

## Breaking
- **A name is removed** \`name-removed\` (\`@a/kernel\`, \`@a/web\`): \`Old\` is gone; use **New**. See [the guide](/x).
- **Second break** \`second-break\`: the text of the second, with no package list.
  A continuation line.

## Added
- **A new thing** \`new-thing\` (\`@a/web\`): it adds \`New\`.

\`\`\`ts
const code = '- **not an item** \`x\`: no';
\`\`\`

## Fixed
- **A fix** \`a-fix\` (\`@a/kernel\`): fixed.
`;

describe('parseItems', () => {
  const items = parseItems({ src: LOG });

  test('reads the id, the title, the section and the packages of each item, in order', () => {
    expect(items.map((item) => [item.section, item.id, item.packages])).toEqual([
      ['Breaking', 'name-removed', ['@a/kernel', '@a/web']],
      ['Breaking', 'second-break', []],
      ['Added', 'new-thing', ['@a/web']],
      ['Fixed', 'a-fix', ['@a/kernel']],
    ]);
    expect(items[0].title).toBe('A name is removed');
  });

  test('the body is the rest of the line and the lines under it, as HTML', () => {
    expect(items[0].html).toBe(
      '<p><code>Old</code> is gone; use <strong>New</strong>. See <a href="/x">the guide</a>.</p>',
    );
    expect(items[1].html).toBe(
      '<p>the text of the second, with no package list. A continuation line.</p>',
    );
  });

  test('a bullet inside a code fence is not an item', () => {
    expect(items.some((item) => item.id === 'x')).toBe(false);
  });

  test('a log with no items has none', () => {
    expect(parseItems({ src: '---\ntitle: x\n---\nJust text.\n' })).toEqual([]);
  });
});

describe('countSections', () => {
  test('counts the items per section, in the order of the sections, leaving out the empty ones', () => {
    const counts = countSections({ items: parseItems({ src: LOG }) });

    expect(counts).toEqual([
      ['Breaking', 2],
      ['Added', 1],
      ['Fixed', 1],
    ]);
    expect(SECTION_NAMES).toEqual([
      'Breaking',
      'Deprecated',
      'Added',
      'Changed',
      'Fixed',
      'Security',
    ]);
  });
});

describe('renderInline', () => {
  test('code, bold, links; everything else escaped', () => {
    expect(renderInline({ text: 'a <b> & `x < y` **bold** [t](https://e.test)' })).toBe(
      'a &lt;b&gt; &amp; <code>x &lt; y</code> <strong>bold</strong> <a href="https://e.test">t</a>',
    );
  });

  test('a link that is not http, https, a path or an anchor is text, never an href', () => {
    expect(renderInline({ text: '[x](javascript:alert(1))' })).toBe('x');
    expect(renderInline({ text: '[x](/a#b)' })).toBe('<a href="/a#b">x</a>');
  });

  test('a <code v-pre> span of the wiki markup is a plain code span', () => {
    expect(renderInline({ text: '<code v-pre>{{value}}</code> is escaped' })).toBe(
      '<code>{{value}}</code> is escaped',
    );
  });
});

describe('renderParagraphs', () => {
  test('blank lines split paragraphs; a fenced block is a code block', () => {
    expect(
      renderParagraphs({ text: 'one\ntwo\n\nthree\n\n```ts\nconst a = 1 < 2;\n```\n\nfour' }),
    ).toBe('<p>one two</p><p>three</p><pre><code>const a = 1 &lt; 2;</code></pre><p>four</p>');
  });
});

describe('firstSentence and shortPackage', () => {
  test('the first sentence of a paragraph, and the package without its scope', () => {
    expect(firstSentence({ text: 'It does things. It also does others.' })).toBe('It does things.');
    expect(firstSentence({ text: 'No full stop here' })).toBe('No full stop here');
    expect(shortPackage({ name: '@venizia/ignis-kernel' })).toBe('ignis-kernel');
    expect(shortPackage({ name: 'dev-configs' })).toBe('dev-configs');
  });
});
