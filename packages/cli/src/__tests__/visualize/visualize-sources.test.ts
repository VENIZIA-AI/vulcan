import { describe, expect, test } from 'bun:test';
import { SpecPage, VisualizeLimits } from '../../visualize/index.ts';
import { fullSpec } from './spec.fixture.ts';

const render = (spec: Record<string, unknown>) =>
  SpecPage.renderText({ text: JSON.stringify(spec) });
const rendered = (spec: Record<string, unknown>): string => {
  const result = render(spec);

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};
const problems = (spec: Record<string, unknown>): string => {
  const result = render(spec);

  return result.ok ? '' : result.problems.join('\n');
};
const COMMIT = 'a55559a1b2c3d4e5f60718293a4b5c6d7e8f9012';
const OTHER = '1234567890abcdef1234567890abcdef12345678';
const source = (change: Record<string, unknown> = {}) => ({
  repo: 'VENIZIA-AI/vulcan',
  commit: COMMIT,
  path: 'packages/cli/src/visualize/render.ts',
  lines: '12-30',
  ...change,
});

/** The full spec with a source on a box and a step of the flow and on a compare box. */
const withSources = (): Record<string, unknown> => {
  const spec = fullSpec();
  const flow = spec['flow'] as {
    nodes: Record<string, unknown>[];
    steps: Record<string, unknown>[];
  };

  flow.nodes[1] = { ...flow.nodes[1], source: source() };
  flow.nodes[2] = { ...flow.nodes[2], source: source({ path: 'docs/check.md', lines: '7' }) };
  flow.steps[0] = { ...flow.steps[0], source: source({ commit: OTHER, lines: undefined }) };

  return {
    ...spec,
    compare: {
      a: 'Before',
      b: 'After',
      nodes: [
        { id: 'one', label: 'One', row: 0, col: 0, source: source() },
        { id: 'two', label: 'Two', row: 0, col: 1 },
      ],
      edges: [{ from: 'one', to: 'two', label: 'adds', in: 'b' }],
    },
  };
};

const withNodeSource = (given: Record<string, unknown>): Record<string, unknown> => {
  const spec = fullSpec();
  const flow = spec['flow'] as { nodes: Record<string, unknown>[] };

  flow.nodes[0] = { ...flow.nodes[0], source: given };

  return spec;
};

const withTerms = (terms: unknown): Record<string, unknown> => ({ ...fullSpec(), terms });

describe('sources', () => {
  test('a source is shown as repo@commit:path:lines, the commit in full, in the detail, the step and the list', () => {
    const html = rendered(withSources());
    const shown = `VENIZIA-AI/vulcan@${COMMIT}:packages/cli/src/visualize/render.ts:12-30`;

    // The box's detail line (hover) and the phone list of the flow.
    expect(html).toContain(`data-detail="ten questions ${shown}"`);
    expect(html).toContain(`<li><b>The form</b> ten questions ${shown}</li>`);
    // The step's note, as its own element, and the line the script reads.
    expect(html).toContain(
      `<p class="explain">The ignore line is checked first. <code class="src">VENIZIA-AI/vulcan@${OTHER}:packages/cli/src/visualize/render.ts</code></p>`,
    );
    expect(html).toContain(`The ignore line is checked first. VENIZIA-AI/vulcan@${OTHER}:packages`);
    // The compare box, in its phone list.
    expect(html).toContain(`<li><b>One</b><code class="src">${shown}</code></li>`);
    // A source with one line, and a box with no detail of its own, use the sublabel or nothing.
    expect(html).toContain(':docs/check.md:7');
  });

  test('the sources part lists each distinct source once, in order of appearance, with what points at it', () => {
    const html = rendered(withSources());
    const part = html.slice(
      html.indexOf('id="sources"'),
      html.indexOf('</section>', html.indexOf('id="sources"')),
    );
    const items = part.match(/<li><code class="src">/g) ?? [];

    expect(part).toContain('<h2 class="sh">Sources</h2>');
    expect(items).toHaveLength(3);
    // The shared source is one row, pointed at by a box of the flow and a box of the compare view.
    expect(part).toContain('<span class="by">How it flows: The form, What differs: One</span>');
    expect(part.indexOf('render.ts:12-30')).toBeLessThan(part.indexOf('docs/check.md:7'));
    expect(part.indexOf('docs/check.md:7')).toBeLessThan(part.indexOf(`@${OTHER}`));
    expect(part).toContain('<span class="by">How it flows: Ignore check</span>');
    expect(part).toContain('<span class="by">Step: Ask</span>');
    expect(html).toContain('<a href="#sources">Sources</a>');
  });

  test('there is no sources part when nothing has a source', () => {
    const html = rendered(fullSpec());

    expect(html).not.toContain('id="sources"');
    expect(html).not.toContain('href="#sources"');
  });

  test('a commit that is not exactly 40 lowercase hex characters is refused', () => {
    for (const commit of [
      'a55559a',
      COMMIT.toUpperCase(),
      `${COMMIT}0`,
      COMMIT.slice(1),
      `g${COMMIT.slice(1)}`,
      'main',
    ]) {
      expect(problems(withNodeSource(source({ commit }))), commit).toContain(
        'is not exactly 40 lowercase hex characters',
      );
    }

    expect(problems(withNodeSource(source()))).toBe('');
  });

  test('a path that is absolute or has .. is refused', () => {
    for (const path of [
      '/etc/passwd',
      '\\windows\\x',
      'C:/x/y.ts',
      '../x.ts',
      'a/../b.ts',
      'a/..',
    ]) {
      expect(problems(withNodeSource(source({ path }))), path).toMatch(
        /is absolute|contains '\.\.'/,
      );
    }

    expect(problems(withNodeSource(source({ path: 'a/b.c.ts' })))).toBe('');
  });

  test('a path that is an address, a home folder or an escaped path is refused, and so is a repo that is not a name', () => {
    for (const path of [
      'file:///etc/passwd',
      'https://evil.example/x',
      '~/.ssh/id_rsa',
      '%2e%2e/x',
    ]) {
      expect(problems(withNodeSource(source({ path }))), path).toContain(
        'is not a plain path inside the repository',
      );
    }

    for (const repo of ['..', '../..', '-x', '.git', 'a/.hidden']) {
      expect(problems(withNodeSource(source({ repo }))), repo).not.toBe('');
    }

    expect(problems(withNodeSource(source({ repo: 'VENIZIA-AI/vulcan' })))).toBe('');
  });

  test('lines must be 12 or 12-30, the start not after the end', () => {
    for (const lines of ['12-', '-5', '30-12', '0', 'a', '1-2-3', '12 - 30', '1,2']) {
      expect(problems(withNodeSource(source({ lines }))), lines).toMatch(
        /is not 12 or 12-30|starts after it ends/,
      );
    }

    expect(problems(withNodeSource(source({ lines: '30-12' })))).toContain('starts after it ends');

    for (const lines of ['12', '12-30', '7-7']) {
      expect(problems(withNodeSource(source({ lines }))), lines).toBe('');
    }

    expect(problems(withNodeSource(source({ lines: undefined })))).toBe('');
  });

  test('a repo that is not owner/name and an unknown key are refused, and the place is named', () => {
    expect(problems(withNodeSource(source({ repo: 'a b' })))).toContain(
      "flow.nodes[0].source: repo 'a b' is not owner/name",
    );
    expect(problems(withNodeSource({ ...source(), branch: 'main' }))).toContain('branch');
    expect(problems(withNodeSource({ repo: 'o/r', commit: COMMIT }))).toContain('path');
    expect(problems(withNodeSource(source({ commit: COMMIT, path: 'ok.ts' })))).toBe('');
  });

  test('a source of a step and of a compare box are checked too', () => {
    const spec = withSources();
    const flow = spec['flow'] as { steps: Record<string, unknown>[] };

    flow.steps[0] = { ...flow.steps[0], source: source({ commit: 'abc' }) };

    expect(problems(spec)).toContain('flow.steps[0].source: commit');

    const compare = withSources()['compare'] as { nodes: Record<string, unknown>[] };

    compare.nodes[0] = { ...compare.nodes[0], source: source({ path: '../x' }) };

    expect(problems({ ...withSources(), compare })).toContain('compare.nodes[0].source: path');
  });

  test('every text of a source is escaped, never markup', () => {
    const html = rendered(withNodeSource(source({ path: 'a<b>"x"&.ts' })));

    expect(html).not.toContain('a<b>');
    expect(html).toContain('a&lt;b&gt;&quot;x&quot;&amp;.ts');
  });
});

describe('terms', () => {
  const terms = [
    { term: 'ignore check', meaning: 'The line that keeps the file out of git.' },
    { term: 'DIGEST', meaning: 'A summary of the answers.' },
  ];

  test('the words of the page are a definition list in a part of their own', () => {
    const html = rendered(withTerms(terms));

    expect(html).toContain('<h2 class="sh">Words in this page</h2>');
    expect(html).toContain(
      '<dl class="terms"><div><dt>ignore check</dt><dd>The line that keeps the file out of git.</dd></div>',
    );
    expect(html).toContain('<a href="#terms">Words in this page</a>');
  });

  test('a term that is in the other text, in any case, gives no warning', () => {
    const result = render(withTerms(terms));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.page.warnings).toEqual([]);
    }
  });

  test('a term that never appears gives a warning, not a refusal', () => {
    const result = render(
      withTerms([
        ...terms,
        { term: 'Quorum', meaning: 'Never used.' },
        { term: 'only here', meaning: 'x' },
      ]),
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.page.warnings).toContain("terms: 'Quorum' never appears in the page text");
      expect(result.page.warnings).toContain("terms: 'only here' never appears in the page text");
      expect(result.page.warnings).toHaveLength(2);
      expect(result.page.html).toContain('<dt>Quorum</dt>');
    }
  });

  test('a term counts only when it is in the page outside the terms part', () => {
    // The word is in its own meaning, which is no use to a reader.
    const result = render(withTerms([{ term: 'zzz', meaning: 'zzz is a word' }]));

    expect(result.ok && result.page.warnings).toEqual([
      "terms: 'zzz' never appears in the page text",
    ]);
  });

  test('a term in a flow label, a source line or the chrome counts', () => {
    const viaSource = withSources();

    expect(
      render({ ...viaSource, terms: [{ term: 'check.md', meaning: 'A doc.' }] }),
    ).toMatchObject({ ok: true, page: { warnings: [] } });
    expect(
      render({ ...fullSpec(), terms: [{ term: 'What you need', meaning: 'The next heading.' }] }),
    ).toMatchObject({ ok: true, page: { warnings: [] } });
  });

  test('at most 12 terms, 40 characters of term, 200 of meaning, and no term twice', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ term: `term${index}`, meaning: 'm' }));

    expect(problems(withTerms(many(12)))).not.toContain('terms');
    expect(problems(withTerms(many(13)))).toContain('terms');
    expect(problems(withTerms([]))).toContain('terms');
    expect(problems(withTerms([{ term: 'x'.repeat(40), meaning: 'm' }]))).not.toContain('terms');
    expect(problems(withTerms([{ term: 'x'.repeat(41), meaning: 'm' }]))).toContain('terms.0.term');
    expect(problems(withTerms([{ term: 't', meaning: 'x'.repeat(200) }]))).not.toContain('terms');
    expect(problems(withTerms([{ term: 't', meaning: 'x'.repeat(201) }]))).toContain(
      'terms.0.meaning',
    );
    expect(problems(withTerms([{ term: 't', meaning: 'a\nb' }]))).toContain('terms.0.meaning');
    expect(
      problems(
        withTerms([
          { term: 'Same', meaning: 'm' },
          { term: 'same', meaning: 'n' },
        ]),
      ),
    ).toContain("terms: 'same' is listed twice");
    expect(problems(withTerms([{ term: 't', meaning: 'm', extra: 1 }]))).toContain('extra');
  });

  test('every term and meaning is escaped, never markup', () => {
    const html = rendered(
      withTerms([{ term: '<em>Digest</em>', meaning: '<script>alert(1)</script>' }]),
    );

    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<dt>&lt;em&gt;Digest&lt;/em&gt;</dt>');
    expect(html).toContain('<dd>&lt;script&gt;alert(1)&lt;/script&gt;</dd>');
  });
});

describe('the page with sources and terms', () => {
  test('the parts come in order: after the log, the words before the sources, the links last', () => {
    const html = rendered({ ...withSources(), terms: [{ term: 'digest', meaning: 'A summary.' }] });
    const at = (id: string): number => html.indexOf(`<section class="part" id="${id}"`);

    expect(at('log')).toBeLessThan(at('terms'));
    expect(at('terms')).toBeLessThan(at('sources'));
    expect(at('sources')).toBeLessThan(at('links'));

    const nav = html.slice(
      html.indexOf('<span class="links">'),
      html.indexOf('</span>', html.indexOf('<span class="links">')),
    );
    const order = [
      '#flow',
      '#compare',
      '#before-after',
      '#log',
      '#terms',
      '#sources',
      '#links',
    ].map((id) => nav.indexOf(`href="${id}"`));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('a Vietnamese page says the Vietnamese words, and the spec may replace them', () => {
    const vi = rendered({
      ...withSources(),
      language: 'vi',
      terms: [{ term: 'digest', meaning: 'Tóm tắt.' }],
    });

    expect(vi).toContain('<h2 class="sh">Nguồn</h2>');
    expect(vi).toContain('<h2 class="sh">Các từ trong trang</h2>');
    expect(vi).toContain('Luồng đi: The form, Điểm khác nhau: One');
    expect(vi).toContain('Bước: Ask');

    const custom = rendered({ ...withSources(), chrome: { sources: 'Quellen' } });

    expect(custom).toContain('<h2 class="sh">Quellen</h2>');
  });

  test('the page stays static and under the size a page should keep, with everything on it', () => {
    const spec = {
      ...withSources(),
      terms: [
        { term: 'digest', meaning: 'A summary of the answers.' },
        { term: 'ignore check', meaning: 'Keeps the file out of git.' },
      ],
      sequence: {
        participants: [
          { id: 'owner', label: 'Owner' },
          { id: 'agent', label: 'Agent' },
        ],
        messages: [
          { from: 'owner', to: 'agent', label: 'asks' },
          { from: 'agent', to: 'owner', label: 'answers', kind: 'reply' },
        ],
      },
      lifecycle: {
        states: [
          { id: 'open', label: 'Open', kind: 'start' },
          { id: 'done', label: 'Done', kind: 'end' },
        ],
        transitions: [{ from: 'open', to: 'done', label: 'closes' }],
      },
      tree: { root: { id: 'root', label: 'Root', children: [{ id: 'leaf', label: 'Leaf' }] } },
      architecture: {
        layers: [
          { label: 'Top', boxes: [{ id: 'a', label: 'A' }] },
          { label: 'Bottom', boxes: [{ id: 'b', label: 'B' }] },
        ],
        links: [{ from: 'a', to: 'b', label: 'uses' }],
      },
      timeline: {
        items: [
          { date: '2026-10-25', title: 'Released', state: 'done' },
          { date: 'Next', title: 'Measured', state: 'in progress' },
        ],
      },
      findings: { numbers: [{ value: '83%', label: 'on Sonnet', state: 'done' }] },
    };
    const result = render(spec);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.page.bytes).toBeLessThan(VisualizeLimits.WARN_BYTES);
      expect(result.page.warnings).toEqual([]);
      expect(result.page.html).not.toMatch(/ style="/);
      expect(result.page.html).not.toMatch(/<(link|img)\b|url\((?!#)|@import/);
      // Without script the sources, the words and the compare list are all there.
      const bare = result.page.html.replace(/<script[\s\S]*?<\/script>/g, '');

      for (const id of ['compare', 'terms', 'sources']) {
        expect(bare, id).toContain(`id="${id}"`);
      }
    }
  });

  test('the printed schema names the source and the terms', () => {
    const schema = SpecPage.specSchemaText();

    for (const key of [
      '"source"',
      '"terms"',
      '"repo"',
      '"commit"',
      '"lines"',
      '"term"',
      '"meaning"',
    ]) {
      expect(schema, key).toContain(key);
    }

    expect(schema).toContain('exactly 40 lowercase hex characters');
  });
});
