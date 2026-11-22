const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s+\d{2,4})?$/i;
/** Labels that name a moment: a year, a month, a day, a week, a quarter, a month name. */
const TIME_LABELS = [
  /^\d{4}$/,
  /^\d{4}-\d{2}(-\d{2})?$/,
  /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
  /^[WQ]\d{1,2}$/i,
  MONTH,
];
/** Labels that carry their own order: a number first, or a bound such as `<10` or `65+`. */
const ORDERED_LABELS = /^[<>≤≥]?\s?\d/;

/** The most parts one segmented bar shows; more are ranked as bars. */
const SEGMENT_MOST = 6;
/** The most bars of a ranking; the tail beyond is folded into one "Other" bar. */
const RANK_MOST = 8;
/** The most series a stacked bar tells apart; the rest are folded into "Other". */
const STACK_MOST = 5;
/** A bar chart of this many values or fewer is a stat line, not a chart. */
const STAT_MOST = 3;

export interface IRow {
  label: string;
  value: number;
}

/**
 * What a chart is drawn as, chosen from its data and never by the agent: a stat line for a few numbers, a line for a
 * time axis, ranked bars for names, one segmented bar or ranked bars for the parts of a whole.
 */
export class ChartShape {
  /** Three or more labels that all name a moment. */
  static isTime(opts: { labels: string[] }): boolean {
    return (
      opts.labels.length >= 3 &&
      opts.labels.every((label) => TIME_LABELS.some((rule) => rule.test(label.trim())))
    );
  }

  /** Labels whose order means something (time, ages, bounds): they keep it. */
  static isOrdered(opts: { labels: string[] }): boolean {
    return (
      ChartShape.isTime(opts) || opts.labels.every((label) => ORDERED_LABELS.test(label.trim()))
    );
  }

  /** The form of a bar chart's data. */
  static barForm(opts: { labels: string[] }): 'stats' | 'line' | 'bars' {
    if (ChartShape.isTime(opts)) {
      return 'line';
    }

    return opts.labels.length <= STAT_MOST ? 'stats' : 'bars';
  }

  /** The rows of a bar chart: largest first, unless the labels are ordered. */
  static ranked(opts: { rows: IRow[]; isOrdered: boolean }): IRow[] {
    return opts.isOrdered ? opts.rows : [...opts.rows].sort((a, b) => b.value - a.value);
  }

  /** The form of the parts of a whole. */
  static partsForm(opts: { count: number }): 'segmented' | 'ranked' {
    return opts.count <= SEGMENT_MOST ? 'segmented' : 'ranked';
  }

  /** The largest `RANK_MOST - 1` rows, and the rest folded into one row named `other`. */
  static foldRows(opts: { rows: IRow[]; other: string }): IRow[] {
    if (opts.rows.length <= RANK_MOST) {
      return opts.rows;
    }

    const kept = opts.rows.slice(0, RANK_MOST - 1);
    const rest = opts.rows.slice(RANK_MOST - 1).reduce((sum, row) => sum + row.value, 0);

    return [...kept, { label: opts.other, value: rest }];
  }

  /** The series of a stacked bar: the first `STACK_MOST`, and the rest added up into one series named `other`. */
  static foldSeries(opts: {
    series: { name: string; values: number[] }[];
    other: string;
  }): { name: string; values: number[]; isOther: boolean }[] {
    const kept = opts.series.slice(0, STACK_MOST).map((s) => ({ ...s, isOther: false }));
    const rest = opts.series.slice(STACK_MOST);

    if (rest.length === 0) {
      return kept;
    }

    const first = rest[0]?.values ?? [];

    return [
      ...kept,
      {
        name: opts.other,
        values: first.map((_, at) => rest.reduce((sum, s) => sum + (s.values[at] ?? 0), 0)),
        isOther: true,
      },
    ];
  }

  /** Short items (40 characters or fewer) in a list of more than 8 sit in two columns on a wide page. */
  static isColumned(opts: { items: string[] }): boolean {
    return opts.items.length > 8 && opts.items.every((item) => item.length <= 40);
  }
}
