import { IconSet } from './icons.ts';
import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import { FigureLayout } from './layout.ts';
import { ChartShape } from './chart-shape.ts';
import type { IRow } from './chart-shape.ts';
import type { TVisualizeSpec } from './schema.ts';

type TChart = NonNullable<NonNullable<TVisualizeSpec['findings']>['charts']>[number];

const escaped = (value: string): string => FigureLayout.escapeText({ value });

const shorten = (opts: { value: string; max: number }): string =>
  opts.value.length <= opts.max ? opts.value : `${opts.value.slice(0, opts.max - 1)}…`;

/** A bar anchored to its baseline: square at the base, 4 px round at the data end. */
const barPath = (opts: { x: number; y: number; width: number; height: number }): string => {
  const { x, y, width, height } = opts;
  const r = Math.min(4, width / 2, height / 2);

  return `M${x} ${y}h${width - r}a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(width - r)}z`;
};

/** A readable axis: a step of 1, 2 or 5 times a power of ten, and the bounds that hold the data. */
const niceScale = (opts: {
  min: number;
  max: number;
  ticks: number;
}): { low: number; high: number; step: number } => {
  const span = opts.max - opts.min || Math.abs(opts.max) || 1;
  const raw = span / opts.ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;

  return { low: Math.floor(opts.min / step) * step, high: Math.ceil(opts.max / step) * step, step };
};

const VIEW_WIDTH = 340;

const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

/** The page colour of a state tone: what waits for the owner is the project's accent, the rest are fixed. */
const TONE_COLOURS: Record<string, string> = {
  ok: 'var(--ok)',
  warn: 'var(--accent)',
  bad: 'var(--bad)',
  info: 'var(--info)',
  mut: 'var(--muted)',
};

const partColour = (opts: { index: number; state?: string }): string =>
  opts.state === undefined
    ? (SLOTS[opts.index] ?? 'var(--s5)')
    : (TONE_COLOURS[NodeStates.toneOf(opts.state)] ?? 'var(--muted)');

/** The swatch attribute of a series or part: its slot, or its state tone. */
const swatch = (opts: { index: number; state?: string }): string =>
  opts.state === undefined
    ? `data-s="${opts.index + 1}"`
    : `data-t="${NodeStates.toneOf(opts.state)}"`;

export class SpecCharts {
  /**
   * Horizontal bars, one row each. A negative value turns it into bars around a zero line; otherwise every bar starts
   * at the left baseline.
   */
  private static bars(opts: { title: string; unit?: string; rows: IRow[] }): string {
    const { rows } = opts;
    const unit = escaped(opts.unit ?? '');
    const isDiverging = rows.some((row) => row.value < 0);
    const largest = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
    const rowHeight = 30;
    const left = 120;
    const plot = 150;

    return `<svg viewBox="0 0 ${VIEW_WIDTH} ${rows.length * rowHeight + 8}" role="img" aria-label="${escaped(opts.title)}">${rows
      .map((row, index) => {
        const y = index * rowHeight + 6;
        const share = Math.abs(row.value) / largest;
        const text = `${SpecCharts.formatNumber({ value: row.value })}${unit}`;
        const label = `<title>${escaped(row.label)}: ${text}</title><text x="0" y="${y + 16}" class="ct">${escaped(shorten({ value: row.label, max: 18 }))}</text>`;

        if (isDiverging) {
          const half = plot / 2;
          const width = Math.max(2, Math.round(share * half));
          const x = row.value < 0 ? left + half - width : left + half;

          return `<g>${label}<rect x="${left}" y="${y + 2}" width="${plot}" height="18" rx="4" class="ctrack"/><rect x="${x}" y="${y + 2}" width="${width}" height="18" fill="${row.value < 0 ? 'var(--s2)' : 'var(--s1)'}"/><line x1="${left + half}" x2="${left + half}" y1="${y}" y2="${y + 22}" class="cgrid"/><text x="${left + plot + 6}" y="${y + 16}" class="cv">${text}</text></g>`;
        }

        const width = Math.max(2, Math.round(share * plot));

        return `<g>${label}<rect x="${left}" y="${y + 2}" width="${plot}" height="18" rx="4" class="ctrack"/><path d="${barPath({ x: left, y: y + 2, width, height: 18 })}" fill="var(--s1)"/><text x="${left + width + 6}" y="${y + 16}" class="cv">${text}</text></g>`;
      })
      .join('')}</svg>`;
  }

  /** A few numbers (three or fewer) as large figures with their labels: nothing to compare, so no chart. */
  private static statLine(opts: { rows: IRow[]; unit?: string }): string {
    return `<ul class="stats">${opts.rows
      .map(
        (row) =>
          `<li><b>${SpecCharts.formatNumber({ value: row.value })}${escaped(opts.unit ?? '')}</b><span>${escaped(row.label)}</span></li>`,
      )
      .join('')}</ul>`;
  }

  private static lineChart(opts: {
    title: string;
    unit?: string;
    labels: string[];
    series: { name: string; values: number[] }[];
    emphasis?: string;
  }): string {
    const { labels, series } = opts;
    const colourOf = (name: string, index: number): string =>
      opts.emphasis === undefined
        ? `var(--s${index + 1})`
        : name === opts.emphasis
          ? 'var(--accent)'
          : 'var(--muted)';
    const all = series.flatMap((s) => s.values.slice(0, labels.length));
    const scale = niceScale({ min: Math.min(...all), max: Math.max(...all), ticks: 4 });
    const left = 44;
    const right = 64;
    const top = 12;
    const height = 150;
    const plot = VIEW_WIDTH - left - right;
    const x = (index: number): number => left + (index / (labels.length - 1)) * plot;
    const y = (value: number): number =>
      top + height - ((value - scale.low) / (scale.high - scale.low || 1)) * height;
    const ticks: number[] = [];

    for (let value = scale.low; value <= scale.high + scale.step / 2; value += scale.step) {
      ticks.push(Math.round(value * 1000) / 1000);
    }

    const every = labels.length > 6 ? Math.ceil(labels.length / 6) : 1;
    // The direct labels sit at the last point of each line; where two would touch, they are pushed apart by 15 px.
    const ends = series
      .map((s, index) => ({ index, y: y(s.values.slice(0, labels.length).at(-1) ?? 0) }))
      .sort((a, b) => a.y - b.y);

    for (let at = 1; at < ends.length; at += 1) {
      const previous = ends[at - 1];
      const current = ends[at];

      if (previous !== undefined && current !== undefined && current.y - previous.y < 15) {
        current.y = previous.y + 15;
      }
    }

    const labelY = new Map(ends.map((end) => [end.index, end.y]));
    // Four lines or fewer are named at their end; more are named by the legend alone.
    const isNamed = series.length <= 4;

    return `<svg viewBox="0 0 ${VIEW_WIDTH} ${top + height + 34}" role="img" aria-label="${escaped(opts.title)}">${ticks
      .map(
        (tick) =>
          `<line x1="${left}" x2="${VIEW_WIDTH - right}" y1="${y(tick)}" y2="${y(tick)}" class="cgrid"/><text x="${left - 6}" y="${y(tick) + 4}" text-anchor="end" class="ct">${SpecCharts.formatNumber({ value: tick })}</text>`,
      )
      .join('')}${labels
      .map((label, index) =>
        index % every === 0
          ? `<text x="${x(index)}" y="${top + height + 20}" text-anchor="middle" class="ct">${escaped(shorten({ value: label, max: 8 }))}</text>`
          : '',
      )
      .join('')}${series
      .map((s, index) => {
        const points = s.values.slice(0, labels.length);
        const path = points.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(value)}`).join('');
        const last = points.at(-1) ?? 0;
        const colour = colourOf(s.name, index);

        return `<g><path d="${path}" fill="none" stroke="${colour}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${points
          .map(
            (value, i) =>
              `<circle cx="${x(i)}" cy="${y(value)}" r="4.5" fill="${colour}" class="cring"><title>${escaped(s.name)}, ${escaped(labels[i] ?? '')}: ${SpecCharts.formatNumber({ value })}${escaped(opts.unit ?? '')}</title></circle>`,
          )
          .join(
            '',
          )}${isNamed ? `<text x="${VIEW_WIDTH - right + 8}" y="${(labelY.get(index) ?? y(last)) + 4}" class="cv">${escaped(shorten({ value: s.name, max: 8 }))}</text>` : ''}</g>`;
      })
      .join('')}</svg>`;
  }

  /** The parts of one whole as a single bar, each part its own block with a 2 px gap; the legend names and counts them. */
  private static segmented(opts: {
    title: string;
    unit?: string;
    parts: { label: string; value: number; state?: string }[];
  }): string {
    const total = opts.parts.reduce((sum, part) => sum + part.value, 0) || 1;
    const width = VIEW_WIDTH - 2 * (opts.parts.length - 1);
    let at = 0;

    return `<svg viewBox="0 0 ${VIEW_WIDTH} 36" class="seg-svg" role="img" aria-label="${escaped(opts.title)}">${opts.parts
      .map((part, index) => {
        const size = (part.value / total) * width;
        const out = `<rect x="${at.toFixed(2)}" y="0" width="${Math.max(0, size).toFixed(2)}" height="36" rx="3" fill="${partColour({ index, state: part.state })}"><title>${escaped(part.label)}: ${SpecCharts.formatNumber({ value: part.value })}${escaped(opts.unit ?? '')}</title></rect>`;

        at += size + 2;

        return out;
      })
      .join('')}</svg>`;
  }

  /** One horizontal stacked bar per group; a series past the fifth is already folded into "Other". */
  private static stack(opts: {
    title: string;
    unit?: string;
    groups: string[];
    series: { name: string; values: number[]; isOther: boolean }[];
  }): string {
    const rowHeight = 30;
    const left = 100;
    const plot = 190;
    const totals = opts.groups.map((_, at) =>
      opts.series.reduce((sum, s) => sum + (s.values[at] ?? 0), 0),
    );
    const largest = Math.max(...totals, 1);

    return `<svg viewBox="0 0 ${VIEW_WIDTH} ${opts.groups.length * rowHeight + 8}" role="img" aria-label="${escaped(opts.title)}">${opts.groups
      .map((group, row) => {
        const y = row * rowHeight + 6;
        let at = left;
        const segments = opts.series
          .map((s, index) => {
            const size = ((s.values[row] ?? 0) / largest) * plot;
            const out =
              size <= 0
                ? ''
                : `<rect x="${at.toFixed(2)}" y="${y + 2}" width="${Math.max(0, size - 2).toFixed(2)}" height="18" fill="${s.isOther ? 'var(--muted)' : (SLOTS[index] ?? 'var(--s5)')}"><title>${escaped(group)}, ${escaped(s.name)}: ${SpecCharts.formatNumber({ value: s.values[row] ?? 0 })}${escaped(opts.unit ?? '')}</title></rect>`;

            at += size;

            return out;
          })
          .join('');

        return `<g><text x="0" y="${y + 16}" class="ct">${escaped(shorten({ value: group, max: 14 }))}</text>${segments}<text x="${at + 6}" y="${y + 16}" class="cv">${SpecCharts.formatNumber({ value: totals[row] ?? 0 })}${escaped(opts.unit ?? '')}</text></g>`;
      })
      .join('')}</svg>`;
  }

  /** A name, a bar and a figure for each row, every bar against its own limit. */
  private static meters(opts: {
    rows: { label: string; value: number; of: number; unit?: string }[];
  }): string {
    return `<ul class="meters">${opts.rows
      .map((row) => {
        const share = Math.min(100, (row.value / row.of) * 100);

        return `<li><span class="ml">${escaped(row.label)}</span><svg class="mb" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${escaped(row.label)}: ${Math.round(share)}%"><rect class="t-info" x="0" width="${share.toFixed(2)}" height="8"/></svg><b>${SpecCharts.formatNumber({ value: row.value })} / ${SpecCharts.formatNumber({ value: row.of })}${escaped(row.unit ?? '')}</b></li>`;
      })
      .join('')}</ul>`;
  }

  /** A table of exact values: a column whose cells are all numbers is right-aligned. */
  private static dataTable(opts: { columns: string[]; rows: string[][] }): string {
    const isNumeric = opts.columns.map((_, at) =>
      opts.rows.every((row) => /^[-+]?[\d.,]+\s?[%a-zA-Z]{0,3}$/.test((row[at] ?? '').trim())),
    );

    return `<div class="tw"><table class="data"><thead><tr>${opts.columns.map((name, at) => `<th${isNumeric[at] === true ? ' class="r"' : ''}>${escaped(name)}</th>`).join('')}</tr></thead><tbody>${opts.rows.map((row) => `<tr>${row.map((cell, at) => `<td${isNumeric[at] === true ? ' class="r"' : ''}>${escaped(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /** The figures of a number and, when it has a trend, a small line beside it: no axis, the last point marked. */
  static sparkline(opts: { points: number[] }): string {
    const low = Math.min(...opts.points);
    const high = Math.max(...opts.points);
    const x = (at: number): number => 2 + (at / (opts.points.length - 1)) * 56;
    const y = (value: number): number => 16 - ((value - low) / (high - low || 1)) * 14;
    const path = opts.points
      .map((value, at) => `${at === 0 ? 'M' : 'L'}${x(at).toFixed(1)} ${y(value).toFixed(1)}`)
      .join('');
    const last = opts.points.length - 1;

    return `<svg class="spark" viewBox="0 0 60 18" aria-hidden="true"><path d="${path}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(last).toFixed(1)}" cy="${y(opts.points[last] ?? 0).toFixed(1)}" r="2.5" fill="var(--s1)"/></svg>`;
  }

  private static legend(opts: {
    parts?: { label: string; value: number; state?: string }[];
    unit?: string;
    series?: { name: string; isOther?: boolean }[];
    emphasis?: string;
  }): string {
    if (opts.parts !== undefined) {
      const total = opts.parts.reduce((sum, part) => sum + part.value, 0) || 1;

      return `<ul class="clegend">${opts.parts
        .map(
          (part, index) =>
            `<li><i class="sw" ${swatch({ index, state: part.state })}></i><span>${escaped(part.label)}</span><b>${SpecCharts.formatNumber({ value: part.value })}${escaped(opts.unit ?? '')}</b><em>${Math.round((part.value / total) * 100)}%</em></li>`,
        )
        .join('')}</ul>`;
    }

    if (opts.series !== undefined && opts.series.length > 1) {
      return `<ul class="clegend row">${opts.series
        .map((s, index) => {
          const tone =
            opts.emphasis === undefined
              ? s.isOther === true
                ? 'data-t="mut"'
                : `data-s="${index + 1}"`
              : `data-t="${s.name === opts.emphasis ? 'warn' : 'mut'}"`;

          return `<li><i class="sw" ${tone}></i><span>${escaped(s.name)}</span></li>`;
        })
        .join('')}</ul>`;
    }

    return '';
  }

  /** The data of a chart as a table, as it was given (before the page folded or sorted it). */
  private static tableView(opts: { chart: TChart; chrome: TChrome }): string {
    const { chart, chrome } = opts;
    const num = (value: number): string => SpecCharts.formatNumber({ value });
    let head: string[] = ['', chrome.value];
    let rows: string[][] = [];

    if (chart.type === 'bar') {
      rows = chart.labels.map((label, index) => [label, num(chart.values[index] ?? 0)]);
    } else if (chart.type === 'line') {
      head = ['', ...chart.series.map((s) => s.name)];
      rows = chart.labels.map((label, index) => [
        label,
        ...chart.series.map((s) => num(s.values[index] ?? 0)),
      ]);
    } else if (chart.type === 'stack') {
      head = ['', ...chart.series.map((s) => s.name)];
      rows = chart.groups.map((group, index) => [
        group,
        ...chart.series.map((s) => num(s.values[index] ?? 0)),
      ]);
    } else if (chart.type === 'meter') {
      head = ['', chrome.value, chrome.limit];
      rows = chart.rows.map((row) => [row.label, num(row.value), num(row.of)]);
    } else if (chart.type === 'donut') {
      rows = chart.parts.map((part) => [part.label, num(part.value)]);
    } else {
      return '';
    }

    return `<details class="tv"><summary>${escaped(chrome.tableView)}</summary><div class="tw"><table><thead><tr>${head.map((cell) => `<th>${escaped(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escaped(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }

  /** The drawing of a chart and its legend: the form is chosen here from the data, never by the spec. */
  private static drawing(opts: { chart: TChart; chrome: TChrome }): {
    body: string;
    legend: string;
  } {
    const { chart, chrome } = opts;

    if (chart.type === 'bar') {
      const form = ChartShape.barForm({ labels: chart.labels });
      const rows = chart.labels.map((label, at) => ({ label, value: chart.values[at] ?? 0 }));

      if (form === 'stats') {
        return { body: SpecCharts.statLine({ rows, unit: chart.unit }), legend: '' };
      }

      if (form === 'line') {
        return {
          body: SpecCharts.lineChart({
            title: chart.title,
            unit: chart.unit,
            labels: chart.labels,
            series: [{ name: chart.title, values: chart.values }],
          }),
          legend: '',
        };
      }

      const ranked = ChartShape.ranked({
        rows,
        isOrdered: ChartShape.isOrdered({ labels: chart.labels }),
      });

      return {
        body: SpecCharts.bars({ title: chart.title, unit: chart.unit, rows: ranked }),
        legend: '',
      };
    }

    if (chart.type === 'line') {
      return {
        body: SpecCharts.lineChart(chart),
        legend: SpecCharts.legend({ series: chart.series, emphasis: chart.emphasis }),
      };
    }

    if (chart.type === 'donut') {
      if (ChartShape.partsForm({ count: chart.parts.length }) === 'segmented') {
        return {
          body: SpecCharts.segmented({ title: chart.title, unit: chart.unit, parts: chart.parts }),
          legend: SpecCharts.legend({ parts: chart.parts, unit: chart.unit }),
        };
      }

      const ranked = ChartShape.foldRows({
        rows: ChartShape.ranked({
          rows: chart.parts.map((part) => ({ label: part.label, value: part.value })),
          isOrdered: false,
        }),
        other: chrome.other,
      });

      return {
        body: SpecCharts.bars({ title: chart.title, unit: chart.unit, rows: ranked }),
        legend: '',
      };
    }

    if (chart.type === 'stack') {
      const series = ChartShape.foldSeries({ series: chart.series, other: chrome.other });

      return {
        body: SpecCharts.stack({
          title: chart.title,
          unit: chart.unit,
          groups: chart.groups,
          series,
        }),
        legend: SpecCharts.legend({ series }),
      };
    }

    if (chart.type === 'meter') {
      return { body: SpecCharts.meters({ rows: chart.rows }), legend: '' };
    }

    return { body: SpecCharts.dataTable(chart), legend: '' };
  }

  /** One chart as a figure: a title, the drawing, a legend when there is more than one thing to tell apart, and its data as a table. */
  static render(opts: { chart: TChart; chrome: TChrome }): string {
    const { chart } = opts;
    const { body, legend } = SpecCharts.drawing(opts);

    // A table takes the whole row.
    const wide = chart.type === 'table' ? ' wide' : '';

    return `<figure class="chart ${chart.type}${wide}"><figcaption class="lab">${escaped(chart.title)}</figcaption><div class="cbody">${body}${legend}</div>${SpecCharts.tableView({ chart, chrome: opts.chrome })}</figure>`;
  }

  /** Total scores of a comparison as horizontal bars out of the maximum, the recommendation in the accent. */
  static renderTotals(opts: {
    names: string[];
    totals: number[];
    best: number;
    max: number;
    chrome: TChrome;
  }): string {
    const rowHeight = 34;
    const plot = 150;

    return `<svg viewBox="0 0 ${VIEW_WIDTH} ${opts.names.length * rowHeight + 6}" role="img" aria-label="${escaped(opts.chrome.total)}: ${opts.names.map((n, i) => `${escaped(n)} ${opts.totals[i]}`).join(', ')}">${opts.names
      .map((name, index) => {
        const y = index * rowHeight + 4;
        const total = opts.totals[index] ?? 0;
        const width = Math.max(2, Math.round((total / opts.max) * plot));
        const isBest = index === opts.best;

        return `<g><title>${escaped(name)}: ${total} ${escaped(opts.chrome.outOf)} ${opts.max}</title><text x="0" y="${y + 19}" class="ct${isBest ? ' strong' : ''}">${escaped(shorten({ value: name, max: 18 }))}</text><rect x="120" y="${y + 5}" width="${plot}" height="20" rx="4" class="ctrack"/><path d="${barPath({ x: 120, y: y + 5, width, height: 20 })}" fill="${isBest ? 'var(--accent)' : 'var(--muted)'}" opacity="${isBest ? 1 : 0.6}"/><text x="${120 + width + 6}" y="${y + 20}" class="cv">${total}</text></g>`;
      })
      .join('')}</svg>`;
  }

  static stateIcon(opts: { state: string; size?: number }): string {
    return IconSet.iconSvg({ name: NodeStates.iconOf(opts.state), size: opts.size });
  }

  /** 1234567 as 1,234,567 and 0.5 as 0.5: no locale, so the page reads the same everywhere. */
  static formatNumber(opts: { value: number }): string {
    const rounded = Math.round(opts.value * 100) / 100;
    const [whole = '0', fraction] = String(Math.abs(rounded)).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${rounded < 0 ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
  }
}
