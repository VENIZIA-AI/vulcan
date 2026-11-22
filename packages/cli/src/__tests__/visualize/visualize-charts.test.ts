import { describe, expect, test } from 'bun:test';
import { ChartShape } from '../../visualize/chart-shape.ts';
import { renderSpec } from './render.helper.ts';
import { fullSpec } from './spec.fixture.ts';

const htmlOf = (charts: Record<string, unknown>[], numbers?: Record<string, unknown>[]): string => {
  const result = renderSpec({
    ...fullSpec(),
    findings: { charts, ...(numbers ? { numbers } : {}) },
  });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

const problemsOf = (charts: Record<string, unknown>[]): string => {
  const result = renderSpec({ ...fullSpec(), findings: { charts } });

  return result.ok ? '' : result.problems.join('\n');
};

describe('the form of a chart is chosen from its data', () => {
  test('labels that name a moment are time; names and ages are not', () => {
    expect(ChartShape.isTime({ labels: ['2026-01', '2026-02', '2026-03'] })).toBe(true);
    expect(ChartShape.isTime({ labels: ['Jan', 'Feb', 'March'] })).toBe(true);
    expect(ChartShape.isTime({ labels: ['W1', 'W2', 'W3'] })).toBe(true);
    expect(ChartShape.isTime({ labels: ['Q1', 'Q2'] })).toBe(false);
    expect(ChartShape.isTime({ labels: ['plan', 'ship', 'review'] })).toBe(false);
    expect(ChartShape.isOrdered({ labels: ['<10', '10-19', '20+'] })).toBe(true);
    expect(ChartShape.isOrdered({ labels: ['alpha', 'beta'] })).toBe(false);
  });

  test('few numbers are a stat line, a time axis is a line, names are ranked bars', () => {
    expect(ChartShape.barForm({ labels: ['a', 'b', 'c'] })).toBe('stats');
    expect(ChartShape.barForm({ labels: ['2026-01', '2026-02', '2026-03'] })).toBe('line');
    expect(ChartShape.barForm({ labels: ['a', 'b', 'c', 'd'] })).toBe('bars');
  });

  test('ranked bars are sorted largest first unless the labels are ordered', () => {
    const rows = [
      { label: 'a', value: 1 },
      { label: 'b', value: 3 },
    ];

    expect(ChartShape.ranked({ rows, isOrdered: false }).map((row) => row.label)).toEqual([
      'b',
      'a',
    ]);
    expect(ChartShape.ranked({ rows, isOrdered: true }).map((row) => row.label)).toEqual([
      'a',
      'b',
    ]);
  });

  test('parts up to six are one segmented bar, more are ranked, and the tail folds into Other', () => {
    expect(ChartShape.partsForm({ count: 6 })).toBe('segmented');
    expect(ChartShape.partsForm({ count: 7 })).toBe('ranked');

    const rows = Array.from({ length: 10 }, (_, n) => ({ label: `p${n}`, value: 10 - n }));
    const folded = ChartShape.foldRows({ rows, other: 'Other' });

    expect(folded).toHaveLength(8);
    expect(folded.at(-1)).toEqual({ label: 'Other', value: 3 + 2 + 1 });
  });

  test('series past the fifth are added up into Other', () => {
    const series = Array.from({ length: 7 }, (_, n) => ({ name: `s${n}`, values: [1, 2] }));
    const folded = ChartShape.foldSeries({ series, other: 'Other' });

    expect(folded).toHaveLength(6);
    expect(folded.at(-1)).toEqual({ name: 'Other', values: [2, 4], isOther: true });
  });

  test('a list of more than 8 short items is columned', () => {
    expect(ChartShape.isColumned({ items: Array.from({ length: 9 }, () => 'short') })).toBe(true);
    expect(ChartShape.isColumned({ items: Array.from({ length: 8 }, () => 'short') })).toBe(false);
    expect(ChartShape.isColumned({ items: Array.from({ length: 9 }, () => 'x'.repeat(41)) })).toBe(
      false,
    );
  });
});

describe('what each chart is drawn as', () => {
  test('a bar of three values is a stat line; a bar over months is a line; names are bars, largest first', () => {
    const stats = htmlOf([
      { type: 'bar', title: 'Few', labels: ['a', 'b', 'c'], values: [3, 2, 1] },
    ]);

    expect(stats).toContain('<ul class="stats"><li><b>3</b><span>a</span></li>');

    const line = htmlOf([
      {
        type: 'bar',
        title: 'Growth',
        labels: ['2026-01', '2026-02', '2026-03'],
        values: [1, 2, 3],
      },
    ]);

    expect(line).toContain('stroke-linejoin="round"');

    const bars = htmlOf([
      { type: 'bar', title: 'Rank', labels: ['a', 'b', 'c', 'd'], values: [1, 4, 2, 3] },
    ]);

    expect(bars.indexOf('>b<')).toBeLessThan(bars.indexOf('>a<'));
  });

  test('a negative value draws diverging bars around a zero line', () => {
    const html = htmlOf([
      { type: 'bar', title: 'Delta', labels: ['a', 'b', 'c', 'd'], values: [3, -2, 1, -1] },
    ]);

    expect(html).toContain('fill="var(--s2)"');
    expect(html).toContain('class="cgrid"');
  });

  test('a donut is a segmented bar up to six parts, ranked bars beyond, with a table view', () => {
    const parts = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ label: `p${n}`, value: n + 1 }));
    const few = htmlOf([{ type: 'donut', title: 'Split', parts: parts(4) }]);

    expect(few).toContain('class="seg-svg"');
    expect(few).not.toContain('donut-svg');
    expect(few).toContain('<ul class="clegend">');

    const many = htmlOf([{ type: 'donut', title: 'Split', parts: parts(10) }]);

    expect(many).not.toContain('class="seg-svg"');
    expect(many).toContain('>Other<');
    expect(many.match(/<details class="tv">/g)).toHaveLength(1);
  });

  test('a line with an emphasis series takes the accent for it and gray for the rest', () => {
    const html = htmlOf([
      {
        type: 'line',
        title: 'Lines',
        labels: ['a', 'b', 'c'],
        series: [
          { name: 'one', values: [1, 2, 3] },
          { name: 'two', values: [3, 2, 1] },
        ],
        emphasis: 'one',
      },
    ]);

    expect(html).toContain('stroke="var(--accent)"');
    expect(html).toContain('stroke="var(--muted)"');
    expect(
      problemsOf([
        {
          type: 'line',
          title: 'Lines',
          labels: ['a', 'b', 'c'],
          series: [{ name: 'one', values: [1, 2, 3] }],
          emphasis: 'nope',
        },
      ]),
    ).toContain('emphasis');
  });

  test('a stack draws one bar per group, folds the series past five, and names them in a legend', () => {
    const series = Array.from({ length: 7 }, (_, n) => ({ name: `s${n}`, values: [1, 2, 3] }));
    const html = htmlOf([{ type: 'stack', title: 'Mix', groups: ['x', 'y', 'z'], series }]);

    expect(html).toContain('<figure class="chart stack">');
    expect(html).toContain('<ul class="clegend row">');
    expect(html).toContain('<span>Other</span>');
    expect(html).toContain('<details class="tv">');
    expect(
      problemsOf([
        {
          type: 'stack',
          title: 'Mix',
          groups: ['x', 'y'],
          series: [
            { name: 'a', values: [1, 2, 3] },
            { name: 'b', values: [1, 2] },
          ],
        },
      ]),
    ).toContain('3 values for 2 groups');
  });

  test('a meter list gives each row a name, a bar and a figure against its limit', () => {
    const html = htmlOf([
      {
        type: 'meter',
        title: 'Quota',
        rows: [
          { label: 'Disk', value: 30, of: 100, unit: ' GB' },
          { label: 'Seats', value: 4, of: 5 },
        ],
      },
    ]);

    expect(html).toContain('<ul class="meters">');
    expect(html).toContain('<b>30 / 100 GB</b>');
    expect(html).toContain('width="80.00"');
  });

  test('a table right-aligns a column of numbers and refuses a ragged row', () => {
    const html = htmlOf([
      {
        type: 'table',
        title: 'Exact',
        columns: ['Name', 'Count'],
        rows: [
          ['alpha', '12'],
          ['beta', '1,234'],
        ],
      },
    ]);

    expect(html).toContain('<th class="r">Count</th>');
    expect(html).toContain('<td class="r">1,234</td>');
    expect(html).toContain('<td>alpha</td>');
    expect(
      problemsOf([{ type: 'table', title: 'T', columns: ['a', 'b'], rows: [['1']] }]),
    ).toContain('row 1 has 1 cells for 2 columns');
  });

  test('a number with a trend carries a small line beside its figure', () => {
    const html = htmlOf(
      [{ type: 'bar', title: 'B', labels: ['a', 'b', 'c', 'd'], values: [1, 2, 3, 4] }],
      [{ value: '42', label: 'things', trend: [1, 3, 2, 5] }],
    );

    expect(html).toContain('<span class="n">42<svg class="spark"');
  });

  test('every chart text is escaped', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = htmlOf([
      { type: 'table', title: hostile, columns: [hostile, 'b'], rows: [[hostile, hostile]] },
      { type: 'meter', title: hostile, rows: [{ label: hostile, value: 1, of: 2, unit: '<b>' }] },
      {
        type: 'stack',
        title: hostile,
        groups: [hostile, 'y'],
        series: [
          { name: hostile, values: [1, 2] },
          { name: 'b', values: [1, 2] },
        ],
      },
    ]);

    expect(html).not.toContain('<img');
  });
});

describe('a list of more than eight short items is in two columns', () => {
  test('a ul block gets the cols class, a short one does not', () => {
    const many = Array.from({ length: 9 }, (_, n) => `item ${n}`);
    const result = renderSpec({
      ...fullSpec(),
      sections: [
        {
          title: 'T',
          blocks: [
            { type: 'ul', items: many },
            { type: 'ol', items: ['a', 'b'] },
          ],
        },
      ],
    });

    expect(result.ok && result.page.html).toContain('<ul class="cols">');
    expect(result.ok && result.page.html).toContain('<ol><li>a</li>');
  });
});
