import { describe, expect, test } from 'bun:test';
import { PAGE_JS } from '../../visualize/assets.ts';
import { SpecPage } from '../../visualize/index.ts';
import { renderSpec } from './render.helper.ts';
import { fullSpec } from './spec.fixture.ts';

const decision = (extra: Record<string, unknown> = {}) => ({
  question: 'Ask again after an upgrade?',
  options: [
    { label: 'No', effect: 'Nothing is asked.', recommended: true },
    { label: 'Yes', effect: 'The form opens.' },
  ],
  why: 'Answers rarely change.',
  ...extra,
});

const problemsOf = (spec: Record<string, unknown>): string => {
  const result = renderSpec(spec);

  return result.ok ? '' : result.problems.join('\n');
};

const htmlOf = (spec: Record<string, unknown>): string => {
  const result = renderSpec(spec);

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

describe('a decision is a question, two or three options and a reason', () => {
  test('it renders as a numbered card with the recommended option tagged and the detail last', () => {
    const html = htmlOf({ ...fullSpec(), decisions: [decision({ detail: 'a.b = c' })] });

    expect(html).toContain('<h3>Ask again after an upgrade?</h3>');
    expect(html).toContain('<li class="dopt rec"><b>No<span class="tag">Recommended</span></b>');
    expect(html).toContain('<p class="why"><b>Why:</b> Answers rarely change.</p>');
    expect(html.indexOf('class="why"')).toBeLessThan(html.indexOf('class="dt"'));
  });

  test('exactly one option is recommended, and the question ends with a question mark', () => {
    const none = decision({
      options: [
        { label: 'No', effect: 'a' },
        { label: 'Yes', effect: 'b' },
      ],
    });

    expect(problemsOf({ ...fullSpec(), decisions: [none] })).toContain('exactly one option');
    expect(
      problemsOf({ ...fullSpec(), decisions: [decision({ question: 'Ask again' })] }),
    ).toContain('decisions');
  });

  test('code in a question or a label is refused; it goes in the detail', () => {
    for (const question of [
      'Use `values` here?',
      'Does x => y hold?',
      'Is the snake_case name kept?',
      'Does env.get still work?',
      'Pass --force to it?',
      'Is <script> allowed?',
      'Is {use:false} valid?',
    ]) {
      expect(
        problemsOf({ ...fullSpec(), decisions: [decision({ question })] }),
        question,
      ).toContain('no code');
    }

    const label = decision({
      options: [
        { label: 'X.values', effect: 'a', recommended: true },
        { label: 'Yes', effect: 'b' },
      ],
    });

    expect(problemsOf({ ...fullSpec(), decisions: [label] })).toContain('no code');
  });

  test('plain text with product names is accepted', () => {
    for (const question of [
      'Dùng GitHub hay GitLab?',
      'Should we write it in JavaScript?',
      'Does it run on macOS and iPhone?',
      'Can we keep the file(s) as they are?',
    ]) {
      expect(problemsOf({ ...fullSpec(), decisions: [decision({ question })] }), question).toBe('');
    }

    const label = decision({
      options: [
        { label: 'GitHub', effect: 'a', recommended: true },
        { label: 'macOS', effect: 'b' },
      ],
    });

    expect(problemsOf({ ...fullSpec(), decisions: [label] })).toBe('');
  });
});

describe('a section can carry body blocks', () => {
  const sections = [
    {
      title: 'Why it matters',
      blocks: [
        { type: 'p', text: 'Run `bun check` first, then read the result.' },
        { type: 'code', lines: ['const a = 1;', '  return <b>a</b>;'] },
        { type: 'quote', text: 'Keep it plain.' },
        { type: 'ul', items: ['one', 'two'] },
        { type: 'ol', items: ['first', 'second'] },
      ],
    },
  ];

  test('each block is its own element, inline code is a code span, and everything is escaped', () => {
    const html = htmlOf({ ...fullSpec(), sections });

    expect(html).toContain('<section class="part" id="note-1"');
    expect(html).toContain('<p>Run <code>bun check</code> first, then read the result.</p>');
    expect(html).toContain('<pre><code>const a = 1;\n  return &lt;b&gt;a&lt;/b&gt;;</code></pre>');
    expect(html).toContain('<blockquote><p>Keep it plain.</p></blockquote>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(html).toContain('<a href="#note-1">Why it matters</a>');
  });

  test('an unpaired backtick stays text, and a block of another type is refused', () => {
    const odd = [{ title: 'T', blocks: [{ type: 'p', text: 'a ` b' }] }];

    expect(htmlOf({ ...fullSpec(), sections: odd })).toContain('<p>a ` b</p>');
    expect(
      problemsOf({
        ...fullSpec(),
        sections: [{ title: 'T', blocks: [{ type: 'html', text: 'x' }] }],
      }),
    ).toContain('sections');
  });
});

describe('hostile text stays text', () => {
  const hostile = '<img src=x onerror=alert(1)>';

  test('an inline code span, a quote, a decision and its detail are escaped', () => {
    const html = htmlOf({
      ...fullSpec(),
      decisions: [decision({ why: hostile, detail: hostile })],
      sections: [
        {
          title: 'T',
          blocks: [
            { type: 'p', text: `a \`${hostile}\` b` },
            { type: 'quote', text: hostile },
            { type: 'ul', items: [hostile] },
          ],
        },
      ],
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('<code>&lt;img src=x onerror=alert(1)&gt;</code>');
    expect(html).toContain('<blockquote><p>&lt;img');
  });
});

describe('the language is the owner profile and nothing else', () => {
  test('the page is English unless the profile says vi, and a spec cannot say it', () => {
    expect(htmlOf(fullSpec())).toContain('<html lang="en">');
    expect(htmlOf({ ...fullSpec(), language: 'vi' })).toContain('<html lang="vi">');
    expect(htmlOf({ ...fullSpec(), language: 'vi' })).toContain('Các bước');

    const own = SpecPage.renderText({ text: JSON.stringify({ ...fullSpec(), language: 'vi' }) });

    expect(own.ok).toBe(false);
    expect(!own.ok && own.problems.join()).toContain('language');
  });
});

describe('a page for the owner is not presented', () => {
  test('?present=1 only acts where the Present button exists', () => {
    expect(PAGE_JS).toContain("if(pb&&new URLSearchParams(location.search).get('present')==='1')");
  });
});

describe('write it plainly: a sentence of more than 30 words is a warning', () => {
  test('it names the sentence, and code lines and the owner chrome are not prose', () => {
    const long = Array.from({ length: 31 }, () => 'word').join(' ');
    const result = renderSpec({ ...fullSpec(), verdict: `${long}.` });

    expect(result.ok ? result.page.warnings.join('\n') : 'refused').toContain('more than 30 words');

    const detail = renderSpec({
      ...fullSpec(),
      decisions: [decision({ detail: long })],
    });

    expect(detail.ok ? detail.page.warnings.join('\n') : 'refused').not.toContain(
      'more than 30 words',
    );

    const code = renderSpec({
      ...fullSpec(),
      sections: [{ title: 'T', blocks: [{ type: 'code', lines: [long] }] }],
    });

    expect(code.ok ? code.page.warnings.join('\n') : 'refused').not.toContain('more than 30 words');
  });
});
