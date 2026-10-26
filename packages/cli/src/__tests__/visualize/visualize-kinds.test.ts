import { describe, expect, test } from 'bun:test';
import { PAGE_JS } from '../../visualize/assets.ts';
import { renderSpecText, specSchemaText, VisualizeLimits } from '../../visualize/index.ts';
import { fullSpec } from './spec.fixture.ts';

const render = (spec: Record<string, unknown>) => renderSpecText({ text: JSON.stringify(spec) });
const rendered = (spec: Record<string, unknown>): string => {
  const result = render(spec);

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};
const problems = (spec: Record<string, unknown>): string[] => {
  const result = render(spec);

  return result.ok ? [] : result.problems;
};

const kindsSpec = (): Record<string, unknown> => ({
  ...fullSpec(),
  actions: ['Read the options.', 'Choose one.'],
  comparison: {
    criteria: ['Security', 'Speed', 'Simplicity'],
    options: [
      {
        name: 'Central service',
        line: 'Asks on every request.',
        scores: [5, 2, 3],
        pros: ['Always current'],
        cons: ['A call per request'],
      },
      { name: 'Snapshot', scores: [4, 5, 4], pros: ['No call per request'], recommended: true },
      { name: 'Per route', scores: [3, 4, 5], cons: ['Rules are scattered'] },
    ],
    note: 'Scores are judgements.',
  },
  ideaMap: {
    center: 'Pick the right skill',
    branches: [
      { label: 'Description', items: ['Triggers', 'A skip list'], note: 'The one source.' },
      { label: 'Catalog', items: ['Budget'] },
      { label: 'Eval', items: ['Near-misses', 'Held out'] },
    ],
  },
  explainer: {
    steps: [
      {
        title: 'A line',
        text: 'Each skill becomes one line.',
        diagram: {
          type: 'row',
          nodes: [{ label: 'SKILL.md', sub: 'name, body' }, { label: 'One line' }],
          arrows: ['listed'],
        },
      },
      {
        title: 'A budget',
        text: 'The listing is capped.',
        diagram: {
          type: 'layers',
          layers: [
            { label: 'Always', items: ['names'] },
            { label: 'While it fits', items: ['descriptions'] },
          ],
        },
      },
      { title: 'A match', text: 'The best line wins.' },
    ],
  },
  architecture: {
    layers: [
      {
        label: 'Sites',
        boxes: [
          { id: 'a', label: 'Site A', state: 'done' },
          { id: 'b', label: 'Site B' },
        ],
      },
      {
        label: 'Theme',
        boxes: [{ id: 'c', label: 'Shared theme', sub: 'canonical', state: 'in progress' }],
      },
    ],
    links: [
      { from: 'a', to: 'c', label: 'uses' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'b', label: 'beside' },
    ],
  },
  timeline: {
    items: [
      { date: '2026-10-25', title: 'Released', text: 'Done.', state: 'done' },
      { date: '2026-10-27', title: 'Measured', state: 'in progress' },
      { date: 'Next', title: 'Release candidate', state: 'not started' },
    ],
  },
  findings: {
    numbers: [
      { value: '83%', label: 'on Sonnet', state: 'done' },
      { value: '40%', label: 'on Haiku' },
    ],
    charts: [
      {
        type: 'bar',
        title: 'Triggered',
        unit: '%',
        labels: ['plan', 'ship', 'review'],
        values: [83, 97, 93],
      },
      {
        type: 'line',
        title: 'Held-out',
        labels: ['1', '2', '3'],
        series: [
          { name: 'plan', values: [5, 7, 7] },
          { name: 'ship', values: [5, 4, 4] },
        ],
      },
      {
        type: 'donut',
        title: 'Winners',
        parts: [
          { label: 'design-and-plan', value: 5 },
          { label: 'no skill', value: 3 },
          { label: 'done', value: 2, state: 'done' },
        ],
      },
    ],
    callouts: [{ text: 'Decide prompts missed.', state: 'waiting' }],
  },
  decisionRecord: {
    context: 'Agents rarely load skills.',
    options: [
      { name: 'A block', summary: 'In AGENTS.md.' },
      { name: 'Descriptions', summary: 'Sharper wording.', chosen: true },
    ],
    decision: 'The description is the one source.',
    consequences: ['Twelve rewrites.', 'Nothing in AGENTS.md.'],
  },
});

describe('every kind renders its section', () => {
  test('comparison, idea map, explainer, architecture, timeline, findings and decision record', () => {
    const html = rendered(kindsSpec());

    for (const id of [
      'comparison',
      'idea-map',
      'explainer',
      'architecture',
      'timeline',
      'findings',
      'decision-record',
    ]) {
      expect(html, id).toContain(`id="${id}"`);
    }

    expect(html).toContain('<h3>Central service</h3>');
    expect(html).toContain('class="branch"');
    expect(html).toContain('class="estep"');
    expect(html).toContain('class="tl"');
    expect(html).toContain('<blockquote class="pull">');
  });

  test('the comparison totals each option out of five per criterion and tags the recommended one', () => {
    const html = rendered(kindsSpec());

    expect(html).toContain('<small> out of 15</small>');
    expect(html).toContain('<span class="tag">Recommended</span>');
    expect(html).toContain(
      'aria-label="Total score: Central service 10, Snapshot 13, Per route 12"',
    );
    expect(html).toContain('class="opts n3"');
  });

  test('a score list that does not match the criteria, two picks and too few options are refused', () => {
    const base = kindsSpec();
    const comparison = base['comparison'] as {
      options: Record<string, unknown>[];
      criteria: string[];
    };

    expect(
      problems({
        ...base,
        comparison: {
          ...comparison,
          options: [{ ...comparison.options[0], scores: [1, 2] }, comparison.options[1]],
        },
      }).join(),
    ).toContain('scores for 3 criteria');
    expect(
      problems({
        ...base,
        comparison: {
          ...comparison,
          options: comparison.options.map((o) => ({ ...o, recommended: true })),
        },
      }).join(),
    ).toContain('only one option can be recommended');
    expect(
      problems({ ...base, comparison: { ...comparison, options: [comparison.options[0]] } }).join(),
    ).toContain('comparison');
    expect(
      problems({
        ...base,
        comparison: {
          ...comparison,
          options: [{ ...comparison.options[0], scores: [1, 2, 6] }, comparison.options[1]],
        },
      }).join(),
    ).toContain('comparison');
  });
});

describe('charts are drawn from the data and carry their table', () => {
  test('a bar, a line and a donut, each with a table view and a title', () => {
    const html = rendered(kindsSpec());

    for (const type of ['bar', 'line', 'donut']) {
      expect(html, type).toContain(`<figure class="chart ${type}">`);
    }

    expect(html.match(/<details class="tv">/g)).toHaveLength(3);
    expect(html).toContain('<figcaption class="lab">Triggered</figcaption>');
    expect(html).toContain('stroke="var(--s1)"');
    expect(html).toContain('data-t="ok"');
  });

  test('numbers are formatted without a locale, and a bar starts at the baseline', () => {
    const html = rendered({
      ...kindsSpec(),
      findings: {
        charts: [{ type: 'bar', title: 'Big', labels: ['a', 'b'], values: [1234567, 0] }],
      },
    });

    expect(html).toContain('1,234,567');
    expect(html).toMatch(/<path d="M120 \d+h/);
  });

  test('data that does not line up with its labels, negatives in a bar and too many parts are refused', () => {
    const charts = (kindsSpec()['findings'] as { charts: Record<string, unknown>[] }).charts;
    const withChart = (chart: Record<string, unknown>) =>
      problems({ ...kindsSpec(), findings: { charts: [chart] } }).join();

    expect(withChart({ ...charts[0], values: [1, 2] })).toContain('3 labels for 2 values');
    expect(withChart({ ...charts[0], values: [1, -2, 3] })).toContain('findings');
    expect(withChart({ ...charts[1], series: [{ name: 'x', values: [1, 2] }] })).toContain(
      'findings',
    );
    expect(
      withChart({
        ...charts[1],
        series: [1, 2, 3, 4].map((n) => ({ name: `s${n}`, values: [1, 2, 3] })),
      }),
    ).toContain('findings');
    expect(
      withChart({
        ...charts[2],
        parts: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `p${n}`, value: n })),
      }),
    ).toContain('findings');
    expect(
      withChart({
        type: 'donut',
        title: 'Zero',
        parts: [
          { label: 'a', value: 0 },
          { label: 'b', value: 0 },
        ],
      }),
    ).toContain('every part of the donut is zero');
  });

  test('chart labels are escaped, never markup', () => {
    const html = rendered({
      ...kindsSpec(),
      findings: {
        charts: [
          {
            type: 'bar',
            title: '<img src=x onerror=alert(1)>',
            labels: ['<b>one</b>', 'two'],
            values: [1, 2],
          },
        ],
      },
    });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>one</b>');
    expect(html).toContain('&lt;b&gt;one&lt;/b&gt;');
  });
});

describe('diagrams', () => {
  test('an architecture is bands and boxes with an elbow for every link, and a list for a phone', () => {
    const html = rendered(kindsSpec());

    expect(html).toContain('class="dband"');
    expect(html.match(/class="dlink"/g)).toHaveLength(3);
    expect(html).toContain('<span class="verb">uses</span>');
    expect(html).toMatch(/class="fig f\d+"/);
  });

  test('a box id twice, a link to nowhere and a link to itself are refused', () => {
    const base = kindsSpec();
    const architecture = base['architecture'] as {
      layers: { label: string; boxes: Record<string, unknown>[] }[];
      links: unknown[];
    };

    expect(
      problems({
        ...base,
        architecture: {
          ...architecture,
          layers: [
            {
              label: 'One',
              boxes: [
                { id: 'a', label: 'A' },
                { id: 'a', label: 'B' },
              ],
            },
          ],
        },
      }).join(),
    ).toContain("id 'a' is used twice");
    expect(
      problems({
        ...base,
        architecture: { ...architecture, links: [{ from: 'a', to: 'zzz' }] },
      }).join(),
    ).toContain("names 'zzz', which is not a box");
    expect(
      problems({
        ...base,
        architecture: { ...architecture, links: [{ from: 'a', to: 'a' }] },
      }).join(),
    ).toContain('loops to itself');
  });

  test('an explainer row takes one arrow label fewer than its boxes', () => {
    const base = kindsSpec();
    const steps = (base['explainer'] as { steps: Record<string, unknown>[] }).steps;

    expect(
      problems({
        ...base,
        explainer: {
          steps: [
            {
              ...steps[0],
              diagram: {
                type: 'row',
                nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
                arrows: ['x'],
              },
            },
          ],
        },
      }).join(),
    ).toContain('takes 2 arrow labels');
  });

  test('a flow box can carry a state, shown as an icon, a colour and a word in the list', () => {
    const spec = fullSpec();
    const flow = spec['flow'] as { nodes: Record<string, unknown>[] };

    flow.nodes[0] = { ...flow.nodes[0], state: 'blocked' };

    const html = rendered(spec);

    expect(html).toMatch(/class="node actor c-bad"/);
    expect(
      problems({
        ...spec,
        flow: { ...flow, nodes: [{ ...flow.nodes[0], state: 'fine' }, ...flow.nodes.slice(1)] },
      }).join(),
    ).toContain('flow.nodes');
  });
});

describe('the decision record and the timeline', () => {
  test('the decision is a pull-quote, the chosen option is tagged, and only one can be chosen', () => {
    const html = rendered(kindsSpec());

    expect(html).toContain('<span class="tag">Chosen</span>');
    expect(html).toContain('class="big">The description is the one source.');

    const record = kindsSpec()['decisionRecord'] as { options: Record<string, unknown>[] };

    expect(
      problems({
        ...kindsSpec(),
        decisionRecord: { ...record, options: record.options.map((o) => ({ ...o, chosen: true })) },
      }).join(),
    ).toContain('only one option can be chosen');
  });

  test('a timeline item carries its state as an icon and a word', () => {
    const html = rendered(kindsSpec());

    expect(html).toContain('<li class="c-ok"><span class="dot">');
    expect(html).toContain(
      '<span class="vh">In progress</span>'.replace('In progress', 'in progress'),
    );
  });
});

describe('tiles, actions and the presentation mode', () => {
  test('given tiles replace the counted ones, and actions are a numbered checklist', () => {
    const html = rendered({
      ...kindsSpec(),
      tiles: [{ value: '7', label: 'things', state: 'done' }],
    });

    expect(html).toContain('<span class="n">7</span>');
    expect(html).not.toContain('class="n">1 / 3');
    expect(html).toContain('<ol class="check"><li>Read the options.</li><li>Choose one.</li></ol>');
  });

  test('every section is a slide, with the controls to step through them and the keys in the script', () => {
    const html = rendered(kindsSpec());
    const slides = html.match(/data-slide/g)?.length ?? 0;

    expect(slides).toBeGreaterThanOrEqual(10);
    expect(html).toContain('id="present"');
    expect(html).toContain('<nav class="deck"');
    expect(html).toContain('id="slide-next"');

    for (const key of ['ArrowRight', 'ArrowLeft', 'PageDown', 'Escape', 'Home', 'End']) {
      expect(PAGE_JS, key).toContain(key);
    }

    expect(PAGE_JS).toContain("get('present')==='1'");
  });
});

describe('words, schema and size', () => {
  test('the words of the new kinds are English and a spec replaces them', () => {
    const html = rendered({
      ...kindsSpec(),
      chrome: { comparison: 'Vergleich', findings: 'Ergebnisse', present: 'Zeigen' },
    });

    expect(html).toContain('Vergleich');
    expect(html).toContain('Ergebnisse');
    expect(html).toContain('>Zeigen</button>');
    expect(rendered(kindsSpec())).toContain('>Present</button>');
  });

  test('the printed schema names the new kinds and their limits', () => {
    const schema = specSchemaText();

    for (const key of [
      'comparison',
      'ideaMap',
      'explainer',
      'architecture',
      'timeline',
      'findings',
      'decisionRecord',
      'tiles',
      'actions',
    ]) {
      expect(schema, key).toContain(`"${key}"`);
    }
  });

  test('a page that uses every kind stays under the cap and says its size', () => {
    const result = render(kindsSpec());

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.page.bytes).toBeLessThan(VisualizeLimits.FAIL_BYTES);
      expect(result.page.warnings).toEqual([]);
    }
  });
});
