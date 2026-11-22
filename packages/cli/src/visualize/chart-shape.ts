const MONTHS =
  'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
/** Labels that name a moment: a month name in full or short, a day, a week, a quarter, a Vietnamese month. */
const TIME_LABELS = [
  new RegExp(`^(${MONTHS})\\.?(\\s+\\d{2,4})?$`, 'i'),
  /^tháng\s?\d{1,2}(\s+\d{4})?$/i,
  /^\d{4}-\d{2}(-\d{2})?$/,
  /^\d{4}-W\d{1,2}$/i,
  /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
  /^[WQ]\d{1,2}(\s+\d{4})?$/i,
];
/** A year is a moment only inside a plausible range, and only when every label is one (1000, 2000, 5000 are numbers). */
const isYear = (label: string): boolean =>
  /^\d{4}$/.test(label) && Number(label) >= 1900 && Number(label) <= 2100;
/** Labels that carry their own order: a number first, or a bound such as `<10` or `65+`. */
const ORDERED_LABELS = /^[<>≤≥]?\s?\d/;

/** The most parts one segmented bar shows (the palette has five validated hues); more are ranked as bars. */
const SEGMENT_MOST = 5;
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
    const labels = opts.labels.map((label) => label.trim());

    return (
      labels.length >= 3 &&
      (labels.every(isYear) ||
        labels.every((label) => TIME_LABELS.some((rule) => rule.test(label))))
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
    const same = kept.find((row) => row.label === opts.other);

    // A real part already named like the fold takes the tail, so two rows never share a name.
    return same === undefined
      ? [...kept, { label: opts.other, value: rest }]
      : kept.map((row) => (row === same ? { ...row, value: row.value + rest } : row));
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
    const sums = first.map((_, at) => rest.reduce((sum, s) => sum + (s.values[at] ?? 0), 0));
    const same = kept.find((s) => s.name === opts.other);

    // A real series already named like the fold takes the tail, so two series never share a name.
    if (same !== undefined) {
      return kept.map((s) =>
        s === same ? { ...s, values: s.values.map((value, at) => value + (sums[at] ?? 0)) } : s,
      );
    }

    return [...kept, { name: opts.other, values: sums, isOther: true }];
  }

  /**
   * Which charts take a whole row. Charts sit two to a row; a table is always a row of its own, and a chart left alone
   * at the end of a run of charts (before a table, or last) takes the whole row instead of leaving an empty cell.
   */
  static wideRows(opts: { isTable: boolean[] }): boolean[] {
    const wide = opts.isTable.map((isTable) => isTable);
    let run = 0;

    for (const [at, isTable] of opts.isTable.entries()) {
      if (isTable) {
        run = 0;
      } else {
        run += 1;

        const next = opts.isTable[at + 1];

        if (run % 2 === 1 && (next === undefined || next)) {
          wide[at] = true;
        }
      }
    }

    return wide;
  }

  /** Short items (40 characters or fewer) in a list of more than 8 sit in two columns on a wide page. */
  static isColumned(opts: { items: string[] }): boolean {
    return opts.items.length > 8 && opts.items.every((item) => item.length <= 40);
  }
}
