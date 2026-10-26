import { iconSvg } from './icons.ts';
import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import { escapeText } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

type TChart = NonNullable<NonNullable<TVisualizeSpec['findings']>['charts']>[number];

const escaped = (value: string): string => escapeText({ value });

/** 1234567 as 1,234,567 and 0.5 as 0.5: no locale, so the page reads the same everywhere. */
export const formatNumber = (opts: { value: number }): string => {
  const rounded = Math.round(opts.value * 100) / 100;
  const [whole = '0', fraction] = String(Math.abs(rounded)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${rounded < 0 ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
};

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

const barChart = (opts: { chart: Extract<TChart, { type: 'bar' }> }): string => {
  const { labels, values } = opts.chart;
  const max = Math.max(...values, 1);
  const rowHeight = 30;
  const left = 120;
  const plot = 150;

  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${labels.length * rowHeight + 8}" role="img" aria-label="${escaped(opts.chart.title)}">${labels
    .map((label, index) => {
      const y = index * rowHeight + 6;
      const width = Math.max(2, Math.round(((values[index] ?? 0) / max) * plot));

      return `<g><title>${escaped(label)}: ${formatNumber({ value: values[index] ?? 0 })}${escaped(opts.chart.unit ?? '')}</title><text x="0" y="${y + 16}" class="ct">${escaped(shorten({ value: label, max: 18 }))}</text><rect x="${left}" y="${y + 2}" width="${plot}" height="18" rx="4" class="ctrack"/><path d="${barPath({ x: left, y: y + 2, width, height: 18 })}" fill="var(--s1)"/><text x="${left + width + 6}" y="${y + 16}" class="cv">${formatNumber({ value: values[index] ?? 0 })}${escaped(opts.chart.unit ?? '')}</text></g>`;
    })
    .join('')}</svg>`;
};

const lineChart = (opts: { chart: Extract<TChart, { type: 'line' }> }): string => {
  const { labels, series } = opts.chart;
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

  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${top + height + 34}" role="img" aria-label="${escaped(opts.chart.title)}">${ticks
    .map(
      (tick) =>
        `<line x1="${left}" x2="${VIEW_WIDTH - right}" y1="${y(tick)}" y2="${y(tick)}" class="cgrid"/><text x="${left - 6}" y="${y(tick) + 4}" text-anchor="end" class="ct">${formatNumber({ value: tick })}</text>`,
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

      return `<g><path d="${path}" fill="none" stroke="var(--s${index + 1})" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${points
        .map(
          (value, i) =>
            `<circle cx="${x(i)}" cy="${y(value)}" r="4.5" fill="var(--s${index + 1})" class="cring"><title>${escaped(s.name)}, ${escaped(labels[i] ?? '')}: ${formatNumber({ value })}${escaped(opts.chart.unit ?? '')}</title></circle>`,
        )
        .join(
          '',
        )}<text x="${VIEW_WIDTH - right + 8}" y="${(labelY.get(index) ?? y(last)) + 4}" class="cv">${escaped(shorten({ value: s.name, max: 8 }))}</text></g>`;
    })
    .join('')}</svg>`;
};

const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

const donutColour = (opts: { index: number; state?: string }): string =>
  opts.state === undefined
    ? (SLOTS[opts.index] ?? 'var(--s5)')
    : `var(--${NodeStates.toneOf(opts.state)})`;

const donutChart = (opts: { chart: Extract<TChart, { type: 'donut' }> }): string => {
  const { parts } = opts.chart;
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = parts
    .map((part, index) => {
      const share = part.value / total;
      const length = Math.max(0, share * circumference - 3);
      const out = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${donutColour({ index, state: part.state })}" stroke-width="22" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"><title>${escaped(part.label)}: ${formatNumber({ value: part.value })}${escaped(opts.chart.unit ?? '')}</title></circle>`;

      offset += share * circumference;

      return out;
    })
    .join('');

  return `<svg viewBox="0 0 160 160" class="donut-svg" role="img" aria-label="${escaped(opts.chart.title)}">${segments}<text x="80" y="82" text-anchor="middle" class="cbig">${formatNumber({ value: total })}</text><text x="80" y="100" text-anchor="middle" class="ct">${escaped(opts.chart.unit ?? 'total')}</text></svg>`;
};

const legend = (opts: { chart: TChart }): string => {
  const { chart } = opts;

  if (chart.type === 'donut') {
    const total = chart.parts.reduce((sum, part) => sum + part.value, 0) || 1;

    return `<ul class="clegend">${chart.parts
      .map(
        (part, index) =>
          `<li><i class="sw" ${part.state === undefined ? `data-s="${index + 1}"` : `data-t="${NodeStates.toneOf(part.state)}"`}></i><span>${escaped(part.label)}</span><b>${formatNumber({ value: part.value })}${escaped(chart.unit ?? '')}</b><em>${Math.round((part.value / total) * 100)}%</em></li>`,
      )
      .join('')}</ul>`;
  }

  if (chart.type === 'line' && chart.series.length > 1) {
    return `<ul class="clegend row">${chart.series.map((s, index) => `<li><i class="sw" data-s="${index + 1}"></i><span>${escaped(s.name)}</span></li>`).join('')}</ul>`;
  }

  return '';
};

const tableView = (opts: { chart: TChart; chrome: TChrome }): string => {
  const { chart, chrome } = opts;
  const head =
    chart.type === 'line' ? ['', ...chart.series.map((s) => s.name)] : ['', chrome.value];
  const rows =
    chart.type === 'bar'
      ? chart.labels.map((label, index) => [
          label,
          formatNumber({ value: chart.values[index] ?? 0 }),
        ])
      : chart.type === 'line'
        ? chart.labels.map((label, index) => [
            label,
            ...chart.series.map((s) => formatNumber({ value: s.values[index] ?? 0 })),
          ])
        : chart.parts.map((part) => [part.label, formatNumber({ value: part.value })]);

  return `<details class="tv"><summary>${escaped(chrome.tableView)}</summary><div class="tw"><table><thead><tr>${head.map((cell) => `<th>${escaped(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escaped(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
};

/** One chart as a figure: a title, the drawing, a legend when there is more than one thing to tell apart, and its data as a table. */
export const renderChart = (opts: { chart: TChart; chrome: TChrome }): string => {
  const { chart } = opts;
  const drawing =
    chart.type === 'bar'
      ? barChart({ chart })
      : chart.type === 'line'
        ? lineChart({ chart })
        : donutChart({ chart });

  return `<figure class="chart ${chart.type}"><figcaption class="lab">${escaped(chart.title)}</figcaption><div class="cbody">${drawing}${legend({ chart })}</div>${tableView({ chart, chrome: opts.chrome })}</figure>`;
};

/** Total scores of a comparison as horizontal bars out of the maximum, the recommendation in the accent. */
export const renderTotals = (opts: {
  names: string[];
  totals: number[];
  best: number;
  max: number;
  chrome: TChrome;
}): string => {
  const rowHeight = 34;
  const plot = 150;

  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${opts.names.length * rowHeight + 6}" role="img" aria-label="${escaped(opts.chrome.total)}: ${opts.names.map((n, i) => `${escaped(n)} ${opts.totals[i]}`).join(', ')}">${opts.names
    .map((name, index) => {
      const y = index * rowHeight + 4;
      const total = opts.totals[index] ?? 0;
      const width = Math.max(2, Math.round((total / opts.max) * plot));
      const isBest = index === opts.best;

      return `<g><title>${escaped(name)}: ${total} ${escaped(opts.chrome.outOf)} ${opts.max}</title><text x="0" y="${y + 19}" class="ct${isBest ? ' strong' : ''}">${escaped(shorten({ value: name, max: 18 }))}</text><rect x="120" y="${y + 5}" width="${plot}" height="20" rx="4" class="ctrack"/><path d="${barPath({ x: 120, y: y + 5, width, height: 20 })}" fill="${isBest ? 'var(--acc)' : 'var(--mut)'}" opacity="${isBest ? 1 : 0.6}"/><text x="${120 + width + 6}" y="${y + 20}" class="cv">${total}</text></g>`;
    })
    .join('')}</svg>`;
};

export const stateIcon = (opts: { state: string; size?: number }): string =>
  iconSvg({ name: NodeStates.iconOf(opts.state), size: opts.size });
