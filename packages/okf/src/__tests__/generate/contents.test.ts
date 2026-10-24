import { describe, expect, test } from 'bun:test';
import { CONTENTS_MIN_LINES, withContents } from '../../generate/contents.ts';

const filler = (opts: { lines: number }): string =>
  Array.from({ length: opts.lines }, (_unused, index) => `Line ${index + 1}.`).join('\n');

const LONG = `---
type: Concept
title: Kernel
description: The kernel.
---

# Kernel

The kernel boots the application.

## How it boots

${filler({ lines: 60 })}

\`\`\`md
## Not a heading - inside a fence
\`\`\`

## Bindings & keys

${filler({ lines: 60 })}
`;

describe('withContents', () => {
  test('a file over the limit gains a contents list of its ## headings, under the title', () => {
    const result = withContents({ text: LONG });
    const lines = result.split('\n');
    const start = lines.indexOf('<!-- okf:generated:contents start -->');

    expect(LONG.split('\n').length).toBeGreaterThan(CONTENTS_MIN_LINES);
    expect(lines[start - 2]).toBe('# Kernel');
    expect(lines.slice(start, start + 6)).toEqual([
      '<!-- okf:generated:contents start -->',
      '**Contents**',
      '',
      '- [How it boots](#how-it-boots)',
      '- [Bindings & keys](#bindings--keys)',
      '<!-- okf:generated:contents end -->',
    ]);
    expect(start).toBeLessThan(15);
  });

  test('gen is a fixed point: a second pass changes nothing', () => {
    const once = withContents({ text: LONG });

    expect(withContents({ text: once })).toBe(once);
  });

  test('a stale list is rewritten from the headings the file has now', () => {
    const renamed = withContents({ text: LONG }).replace('## How it boots', '## How it starts');

    expect(withContents({ text: renamed })).toContain('- [How it starts](#how-it-starts)');
    expect(withContents({ text: renamed })).not.toContain('#how-it-boots');
  });

  test('a short file gets no list, and loses one it no longer needs', () => {
    const short = '# Short\n\n## One\n\nText.\n';
    const stale = short.replace(
      '# Short\n',
      '# Short\n\n<!-- okf:generated:contents start -->\n**Contents**\n\n- [One](#one)\n<!-- okf:generated:contents end -->\n',
    );

    expect(withContents({ text: short })).toBe(short);
    expect(withContents({ text: stale })).toBe(short);
  });

  test('a file without frontmatter (AGENTS.md, rules.md) gets it under its title', () => {
    const agents = `# AGENTS.md\n\nRouting.\n\n## Must read\n\n${filler({ lines: 110 })}\n`;
    const result = withContents({ text: agents }).split('\n');

    expect(result[0]).toBe('# AGENTS.md');
    expect(result[2]).toBe('<!-- okf:generated:contents start -->');
  });

  test('markers quoted in a code fence or in prose are text, never a list to strip', () => {
    const fenced = [
      '# Contents lists',
      '',
      'okf writes this near the top:',
      '',
      '```md',
      '<!-- okf:generated:contents start -->',
      '- [Part](#part)',
      '<!-- okf:generated:contents end -->',
      '```',
      '',
    ].join('\n');
    const prose =
      '# Contents\n\nBetween `<!-- okf:generated:contents start -->` and the end marker `<!-- okf:generated:contents end -->` okf owns the text.\n';

    expect(withContents({ text: fenced })).toBe(fenced);
    expect(withContents({ text: prose })).toBe(prose);
  });

  test('a CRLF file keeps its frontmatter first and its CRLF endings', () => {
    const crlf = LONG.replace(/\n/g, '\r\n');
    const result = withContents({ text: crlf });

    expect(result.startsWith('---\r\ntype: Concept')).toBe(true);
    expect(result).toContain('<!-- okf:generated:contents start -->\r\n');
    expect(result.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(withContents({ text: result })).toBe(result);
  });
});

/** The contents list `withContents` writes for a long file with these `##` headings. */
const listOf = (opts: { headings: string[] }): string[] => {
  const body = opts.headings.map((heading) => `## ${heading}\n\nText.\n`).join('\n');
  const lines = withContents({ text: `# Title\n\n${body}\n${filler({ lines: 110 })}\n` }).split(
    '\n',
  );

  return lines.slice(
    lines.indexOf('**Contents**') + 2,
    lines.indexOf('<!-- okf:generated:contents end -->'),
  );
};

describe('contents anchors are the ones GitHub writes', () => {
  test('inline code loses its backticks and dots, an underscore stays', () => {
    expect(listOf({ headings: ['`bun build` folds `process.env.NODE_ENV`'] })).toEqual([
      '- [`bun build` folds `process.env.NODE_ENV`](#bun-build-folds-processenvnode_env)',
    ]);
  });

  test('emphasis markers go, an underscore inside a word stays, entities are decoded', () => {
    expect(
      listOf({
        headings: [
          'The _first_ step',
          '__Bold__ and *both*',
          'snake_case_name',
          'Tom &amp; Jerry &lt;3',
          'A &#8211; B',
        ],
      }),
    ).toEqual([
      '- [The _first_ step](#the-first-step)',
      '- [__Bold__ and *both*](#bold-and-both)',
      '- [snake_case_name](#snake_case_name)',
      '- [Tom &amp; Jerry &lt;3](#tom--jerry-3)',
      '- [A &#8211; B](#a--b)',
    ]);
  });

  test('every space is a hyphen, runs of spaces are not collapsed', () => {
    expect(listOf({ headings: ['Bindings & keys', 'kernel  (12 files)'] })).toEqual([
      '- [Bindings & keys](#bindings--keys)',
      '- [kernel  (12 files)](#kernel--12-files)',
    ]);
  });

  test('a heading with a link lists its text, never nested brackets', () => {
    expect(listOf({ headings: ['See [the spec](https://example.com/spec) first'] })).toEqual([
      '- [See the spec first](#see-the-spec-first)',
    ]);
  });

  test('a repeated heading takes -1, -2, counting the title too', () => {
    expect(listOf({ headings: ['Setup', 'Setup', 'Title', 'Setup'] })).toEqual([
      '- [Setup](#setup)',
      '- [Setup](#setup-1)',
      '- [Title](#title-1)',
      '- [Setup](#setup-2)',
    ]);
  });
});

describe('the 100-line threshold', () => {
  const ofLines = (opts: { lines: number }): string =>
    `# Title\n\n## Part\n\n${filler({ lines: opts.lines - 4 })}\n`;

  test('exactly 100 lines (wc -l) gets no list, 101 does', () => {
    expect(ofLines({ lines: 100 }).match(/\n/g)?.length).toBe(100);
    expect(withContents({ text: ofLines({ lines: 100 }) })).not.toContain('**Contents**');
    expect(withContents({ text: ofLines({ lines: 101 }) })).toContain('**Contents**');
  });
});

describe('code fences', () => {
  test('a 4-backtick fence holding a 3-backtick one stays open until its own close', () => {
    const text = [
      '# Title',
      '',
      '## Real',
      '',
      '````md',
      '```ts',
      '## Not a heading',
      '```',
      '## Still not a heading',
      '````',
      '',
      '~~~',
      '```',
      '## Not one either',
      '~~~',
      '',
      '## Also real',
      '',
      filler({ lines: 110 }),
      '',
    ].join('\n');

    expect(withContents({ text })).toContain(
      '**Contents**\n\n- [Real](#real)\n- [Also real](#also-real)\n<!--',
    );
  });
});
