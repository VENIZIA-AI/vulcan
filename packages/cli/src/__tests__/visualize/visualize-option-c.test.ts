import { describe, expect, test } from 'bun:test';
import { VISUALIZE_SCHEMA } from '../../visualize/index.ts';
import { renderSpec } from './render.helper.ts';

const BASE = {
  schemaVersion: 1,
  title: 'A page',
  verdict: 'It works.',
  status: { state: 'ok' },
};

const render = (extra: Record<string, unknown>): string => {
  const result = renderSpec({ ...BASE, ...extra });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

const GRADES = [
  { label: 'Rules', grade: 'C', note: 'Cut at 2 KB' },
  { label: 'Guards', grade: 'B' },
  { label: 'Knowledge', grade: 'A' },
];
const METRICS = [
  {
    value: '2',
    of: '22.5 KB',
    label: 'Rules the agent can read',
    parts: [
      { label: 'Read', value: 2, tone: 'warn' },
      { label: 'Cut', value: 20.5, tone: 'bad' },
    ],
  },
];

describe('grades', () => {
  test('each item shows its letter and its word, so colour is never the only signal', () => {
    const html = render({ grades: GRADES });

    expect(html).toContain('<span class="gr c-bad"><b>C</b>weak</span>');
    expect(html).toContain('<span class="gr c-info"><b>B</b>has gaps</span>');
    expect(html).toContain('<span class="gr c-ok"><b>A</b>good</span>');
    expect(html).toContain('<span class="gt">Cut at 2 KB</span>');
  });

  test('a letter other than A, B or C is refused', () => {
    expect(
      VISUALIZE_SCHEMA.safeParse({ ...BASE, grades: [{ label: 'x', grade: 'D' }] }).success,
    ).toBe(false);
  });
});

describe('metrics', () => {
  test('a card shows the value, what it is of and a bar split in proportion to its parts', () => {
    const html = render({ metrics: METRICS });

    expect(html).toContain('<p class="mv">2<small>/ 22.5 KB</small></p>');
    expect(html).toContain('<rect class="t-warn" x="0.00" width="8.89" height="8"/>');
    expect(html).toContain('<rect class="t-bad" x="8.89" width="91.11" height="8"/>');
    expect(html).toContain('Read: 2');
  });

  test('a bar of one part, or of parts that are all zero, is refused', () => {
    const one = [{ ...METRICS[0], parts: [{ label: 'Read', value: 2 }] }];
    const zero = [
      {
        ...METRICS[0],
        parts: [
          { label: 'a', value: 0 },
          { label: 'b', value: 0 },
        ],
      },
    ];

    expect(VISUALIZE_SCHEMA.safeParse({ ...BASE, metrics: one }).success).toBe(false);
    expect(VISUALIZE_SCHEMA.safeParse({ ...BASE, metrics: zero }).success).toBe(false);
  });
});
