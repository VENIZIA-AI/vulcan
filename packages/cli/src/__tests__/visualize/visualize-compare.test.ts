import { describe, expect, test } from 'bun:test';
import { renderSpecText, specSchemaText } from '../../visualize/index.ts';
import { fullSpec } from './spec.fixture.ts';

const render = (spec: Record<string, unknown>) => renderSpecText({ text: JSON.stringify(spec) });
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

/** Two ways to release: the second adds a bump before develop, the first has a back-merge the second drops. */
const compareFixture = () => ({
  a: 'Machine',
  b: 'Manual',
  nodes: [
    { id: 'bump', label: 'Bump PR', row: 0, col: 0 },
    { id: 'develop', label: 'develop', sublabel: 'the working branch', row: 1, col: 0 },
    { id: 'main', label: 'main', row: 1, col: 1 },
    { id: 'npm', label: 'npm latest', row: 1, col: 2, state: 'waiting' },
    { id: 'back', label: 'develop again', row: 2, col: 2 },
  ],
  edges: [
    { from: 'develop', to: 'main', label: 'merges' },
    { from: 'main', to: 'npm', label: 'publishes', in: 'both' },
    { from: 'bump', to: 'develop', label: 'raises number', in: 'b' },
    { from: 'npm', to: 'back', label: 'merges back', in: 'a' },
  ],
});

const withCompare = (change?: (compare: ReturnType<typeof compareFixture>) => unknown) => {
  const compare = compareFixture();

  return { ...fullSpec(), compare: change === undefined ? compare : change(compare) };
};

describe('the compare view', () => {
  test('the section comes after the flow and the architecture, and has its title and link', () => {
    const html = rendered({
      ...withCompare(),
      architecture: {
        layers: [{ label: 'Sites', boxes: [{ id: 'a', label: 'Site A' }] }],
      },
    });

    expect(html).toContain('<section class="part" id="compare" data-slide>');
    expect(html).toContain('<h2 class="sh">What differs</h2>');
    expect(html.indexOf('id="flow"')).toBeLessThan(html.indexOf('id="architecture"'));
    expect(html.indexOf('id="architecture"')).toBeLessThan(html.indexOf('id="compare"'));
    expect(html).toContain('<a href="#compare">What differs</a>');
  });

  test('an added and a removed arrow differ by class and by word, a shared one is plain', () => {
    const html = rendered(withCompare());

    expect(html).toMatch(/<g class="edge added" data-ce="bump&gt;develop">/);
    expect(html).toMatch(/<g class="edge removed hot" data-ce="npm&gt;back">/);
    expect(html).toMatch(/<g class="edge main" data-ce="develop&gt;main">/);
    expect(html).toMatch(/<g class="edge main" data-ce="main&gt;npm">/);
    // The words: a sign and who has it alone, on the arrow's label and in its title.
    expect(html).toContain('>+ raises number</text>');
    expect(html).toContain('>- merges back</text>');
    expect(html).toContain('<title>+ only here Manual: raises number</title>');
    expect(html).toContain('<title>- only here Machine: merges back</title>');
    // The key says each line style once, with the same words.
    expect(html).toContain('<span>in both</span>');
    expect(html).toContain('<span>+ only here Manual</span>');
    expect(html).toContain('<span>- only here Machine</span>');
    // Heavy and dotted are in the stylesheet, so the class means a line style and not a colour.
    expect(html).toContain('.edge.added path{stroke:var(--ink);stroke-width:4.5}');
    expect(html).toContain('.edge.removed path{stroke-dasharray:1 7');
  });

  test('the figure is its own: its boxes and arrows carry no hooks for the flow script', () => {
    const html = rendered(withCompare());
    const figure = html.slice(html.indexOf('id="compare"'));

    expect(figure).toContain('data-cn="bump"');
    expect(figure).not.toContain('data-node="bump"');
    expect(figure).not.toContain('data-detail=');
    expect(figure).toContain('aria-label="What differs"');
  });

  test('on a phone the figure gives way to a list in three groups', () => {
    const html = rendered(withCompare());
    const list = /<div class="path cmp">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    const groups = list.split('<p class="cg ').slice(1);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toStartWith('same">in both</p>');
    expect(groups[0]).toContain('<b>develop</b><span class="verb same">merges</span><b>main</b>');
    expect(groups[0]).toContain('publishes');
    expect(groups[1]).toStartWith('added">+ only here Manual</p>');
    expect(groups[1]).toContain('<span class="verb added">raises number</span>');
    expect(groups[1]).not.toContain('merges back');
    expect(groups[2]).toStartWith('removed">- only here Machine</p>');
    expect(groups[2]).toContain('<span class="verb removed">merges back</span>');
    expect(groups[2]).not.toContain('raises number');
    // The page swaps the figure for the list below the width where the figure would shrink.
    expect(html).toMatch(/\.fig\.f\d+~\.path,\.fig\.f\d+~\.path-detail\{display:block\}/);
    expect(html).toMatch(/\.fig\.f\d+~\.legend\{display:none\}/);
    expect(html).toContain('<ul class="legend cmp-key">');
    expect(html).toContain('<ul class="path-detail"><li><b>develop</b>the working branch</li>');
  });

  test('without a changed arrow it is refused, with the sentence', () => {
    const text = problems(
      withCompare((compare) => ({
        ...compare,
        edges: compare.edges.map((edge) => ({ ...edge, in: 'both' })),
      })),
    );

    expect(text).toContain("compare: no edge differs between 'a' and 'b'");
    expect(
      problems(
        withCompare((compare) => ({
          ...compare,
          edges: compare.edges.slice(0, 2).map(({ in: _in, ...edge }) => edge),
        })),
      ),
    ).toContain("compare: no edge differs between 'a' and 'b'");
  });

  test('ids, ends of arrows, cells, blockers, loops and a verbless arrow are refused', () => {
    const base = compareFixture();
    const check = (change: (compare: ReturnType<typeof compareFixture>) => unknown) =>
      problems(withCompare(change));

    expect(
      check((compare) => ({
        ...compare,
        nodes: [...compare.nodes, { id: 'main', label: 'again', row: 3, col: 0 }],
      })),
    ).toContain("compare.nodes: id 'main' is used twice");
    expect(
      check((compare) => ({
        ...compare,
        edges: [...compare.edges, { from: 'main', to: 'nowhere', label: 'goes' }],
      })),
    ).toContain("names 'nowhere', which is not a node");
    expect(
      check((compare) => ({
        ...compare,
        nodes: [...compare.nodes, { id: 'twin', label: 'Twin', row: 1, col: 1 }],
      })),
    ).toContain("'twin' and 'main' are both in row 1, col 1");
    expect(
      check((compare) => ({
        ...compare,
        edges: [...compare.edges, { from: 'develop', to: 'npm', label: 'skips', in: 'a' }],
      })),
    ).toContain("would be drawn through box 'main'");
    expect(
      check((compare) => ({
        ...compare,
        edges: [...compare.edges, { from: 'main', to: 'main', label: 'loops', in: 'a' }],
      })),
    ).toContain('loops to itself');
    expect(
      check((compare) => ({
        ...compare,
        edges: [...compare.edges, { from: 'main', to: 'develop', label: 'back', in: 'a' }],
      })),
    ).toContain('run on the same line');
    expect(
      check((compare) => ({
        ...compare,
        edges: [{ ...base.edges[2], label: '' }, base.edges[0]],
      })),
    ).toContain('compare.edges.0.label');
    expect(check((compare) => ({ ...compare, edges: [] }))).toContain('compare.edges');
  });

  test('the limits are the flow limits: 25 boxes, 40 arrows, a ten by ten grid', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `n${index}`,
        label: `N${index}`,
        row: Math.floor(index / 10),
        col: index % 10,
      }));
    const chain = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        from: `n${index % 9}`,
        to: `n${(index % 9) + 1}`,
        label: `v${index}`,
        in: 'b',
      }));

    expect(problems(withCompare((compare) => ({ ...compare, nodes: many(26) })))).toContain(
      'compare.nodes',
    );
    expect(
      problems(withCompare((compare) => ({ ...compare, nodes: many(25), edges: chain(41) }))),
    ).toContain('compare.edges');
    expect(
      problems(
        withCompare((compare) => ({
          ...compare,
          nodes: [{ id: 'far', label: 'Far', row: 0, col: 10 }, compare.nodes[1]],
        })),
      ),
    ).toContain('compare.nodes.0.col');
    expect(
      problems(
        withCompare((compare) => ({
          ...compare,
          edges: [{ ...compare.edges[2], label: 'x'.repeat(21) }],
        })),
      ),
    ).toContain('compare.edges.0.label');
    expect(
      problems(
        withCompare((compare) => ({ ...compare, edges: [{ ...compare.edges[2], in: 'both-a' }] })),
      ),
    ).toContain('compare.edges.0.in');
  });

  test('every text of the view is escaped, never markup', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const html = rendered(
      withCompare((compare) => ({
        ...compare,
        a: '<img src=x onerror=1>',
        b: '<b>b</b>',
        caption: attack,
        nodes: compare.nodes.map((node, index) =>
          index === 1 ? { ...node, label: attack, sublabel: '<i>sub</i>' } : node,
        ),
        edges: compare.edges.map((edge, index) =>
          index === 2 ? { ...edge, label: '<u>v</u>' } : edge,
        ),
      })),
    );

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>b</b>');
    expect(html).not.toContain('<i>sub</i>');
    expect(html).not.toContain('<u>v</u>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('- only here &lt;img src=x onerror=1&gt;');
    expect(html).toContain('+ only here &lt;b&gt;b&lt;/b&gt;');
    expect(html).toContain('+ &lt;u&gt;v&lt;/u&gt;');
  });

  test('the page stays static: no inline style, no script in the figure, no network', () => {
    const html = rendered(withCompare());
    const figure = html.slice(
      html.indexOf('id="compare"'),
      html.indexOf('</section>', html.indexOf('id="compare"')),
    );

    expect(html).not.toMatch(/ style="/);
    expect(figure).not.toContain('<script');
    expect(figure).not.toContain('<style');
    expect(figure).not.toMatch(/https?:/);
  });

  test('a Vietnamese page says the Vietnamese words, a spec may replace them', () => {
    const vi = rendered({ ...withCompare(), language: 'vi' });

    expect(vi).toContain('<h2 class="sh">Điểm khác nhau</h2>');
    expect(vi).toContain('+ chỉ ở đây Manual');
    expect(vi).toContain('- chỉ ở đây Machine');
    expect(vi).toContain('<span>ở cả hai</span>');
    expect(vi).not.toContain('only here');

    const custom = rendered({
      ...withCompare(),
      chrome: { compareView: 'Unterschiede', onlyHere: 'nur hier', inBoth: 'in beiden' },
    });

    expect(custom).toContain('<h2 class="sh">Unterschiede</h2>');
    expect(custom).toContain('+ nur hier Manual');
    expect(custom).toContain('<span>in beiden</span>');
  });

  test('a caption of the spec replaces the counted one', () => {
    expect(rendered(withCompare())).toContain(
      '<figcaption>+ only here Manual (1), - only here Machine (1)</figcaption>',
    );
    expect(
      rendered(withCompare((compare) => ({ ...compare, caption: 'Two arrows differ.' }))),
    ).toContain('<figcaption>Two arrows differ.</figcaption>');
  });

  test('the printed schema names the compare view', () => {
    const schema = specSchemaText();

    for (const key of ['compare', 'nodes', 'edges', 'caption', '"in"', '"a"', '"b"']) {
      expect(schema, key).toContain(key);
    }

    expect(schema).toContain('(both|a|b)');
  });
});

describe('replacement patterns in the text of a spec', () => {
  // String.prototype.replace reads `$&`, `$'` and a backtick pattern in a replacement string; the text of a spec is
  // escaped, but `$`, a backtick and `=` are not markup, so the page must not read them as patterns either.
  const hostile = ['$`', "$'", '$&', '$`$`$`$`$`$`$`$`$`$`', '$` id=slide-next mask=url(x) '];

  test('a label, a side name or a replaced word with a pattern stays text', () => {
    const control = rendered(withCompare());
    const sections = (html: string): number => html.match(/<section /g)?.length ?? 0;

    for (const text of hostile) {
      const html = rendered({
        ...withCompare((compare) => ({
          ...compare,
          a: text.slice(0, 24),
          b: text.slice(0, 24),
          edges: compare.edges.map((edge) => ({ ...edge, label: text.slice(0, 20) })),
        })),
        chrome: { onlyHere: text, compareView: text },
      });

      expect(sections(html), text).toBe(sections(control));
      expect(html.match(/id="slide-next"/g)?.length, text).toBe(1);
      // The words may appear as text; no tag may carry them as an attribute.
      // (Inside a quoted attribute value it is still text, so the values are taken out first.)
      expect(html.replace(/="[^"]*"/g, '=""'), text).not.toMatch(/<[^>]*\smask=/);
      expect(html.includes('</main>'), text).toBe(true);
      expect(html.length, text).toBeLessThan(control.length + 20000);
    }
  });
});
