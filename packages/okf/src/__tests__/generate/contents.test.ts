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
      '- [Bindings & keys](#bindings-keys)',
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
