import { ChartShape } from './chart-shape.ts';
import { SpecCharts } from './charts.ts';
import type { ISectionContext } from './common/index.ts';
import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import { IconSet } from './icons.ts';
import { FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';
import { SpecSections } from './sections.ts';

const table = (opts: { head: string[]; rows: string[][] }): string =>
  `<div class="tw"><table class="stack"><thead><tr>${opts.head.map((cell) => `<th>${FigureLayout.escapeText({ value: cell })}</th>`).join('')}</tr></thead><tbody>${opts.rows.map((row) => `<tr>${row.join('')}</tr>`).join('')}</tbody></table></div>`;

const cell = (opts: { value: string; label?: string; tag?: boolean }): string =>
  `<td${opts.tag === true ? ' class="tag"' : ''}${opts.label === undefined ? '' : ` data-label="${FigureLayout.escapeText({ value: opts.label })}"`}>${FigureLayout.escapeText({ value: opts.value })}</td>`;

/** Text with `code` spans: the text between a pair of backticks is code; an unpaired backtick is plain text. */
const inline = (value: string): string => {
  const parts = value.split('`');

  return parts.length % 2 === 0
    ? FigureLayout.escapeText({ value: value })
    : parts
        .map((part, index) =>
          index % 2 === 1
            ? `<code>${FigureLayout.escapeText({ value: part })}</code>`
            : FigureLayout.escapeText({ value: part }),
        )
        .join('');
};

type TBlock = NonNullable<TVisualizeSpec['sections']>[number]['blocks'][number];

const blockHtml = (opts: { block: TBlock }): string => {
  const { block } = opts;

  if (block.type === 'p') {
    return `<p>${inline(block.text)}</p>`;
  }

  if (block.type === 'quote') {
    return `<blockquote><p>${inline(block.text)}</p></blockquote>`;
  }

  if (block.type === 'code') {
    return `<pre><code>${FigureLayout.escapeText({ value: block.lines.join('\n') })}</code></pre>`;
  }

  const columns = ChartShape.isColumned({ items: block.items }) ? ' class="cols"' : '';

  return `<${block.type}${columns}>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${block.type}>`;
};

/** The sections that report: numbers, grades, the written parts and the lists of evidence, risks, log and links. */
export class ReportSectionsBuilder {
  /** Big numbers as fields: a tint and an icon for a state, plain for a number that is only a number. */
  static tilesHtml(opts: {
    tiles: { value: string; label: string; state?: string; trend?: number[] }[];
    chrome: TChrome;
  }): string {
    return `<ul class="tiles" aria-label="${FigureLayout.escapeText({ value: opts.chrome.findings })}">${opts.tiles
      .map(
        (tile) =>
          `<li class="tile${tile.state === undefined ? '' : ` c-${NodeStates.toneOf(tile.state)}`}">${tile.state === undefined ? '' : SpecCharts.stateIcon({ state: tile.state, size: 22 })}<span class="n">${FigureLayout.escapeText({ value: tile.value })}${tile.trend === undefined ? '' : SpecCharts.sparkline({ points: tile.trend, chrome: opts.chrome })}</span><span class="l">${FigureLayout.escapeText({ value: tile.label })}</span>${tile.state === undefined ? '' : `<span class="vh">${FigureLayout.escapeText({ value: SpecSections.stateWord({ chrome: opts.chrome, state: tile.state }) })}</span>`}</li>`,
      )
      .join('')}</ul>`;
  }

  static findings(opts: { ctx: ISectionContext }): string {
    const { findings } = opts.ctx.spec;
    const { chrome } = opts.ctx;

    if (findings === undefined) {
      return '';
    }

    const wideRows = ChartShape.wideRows({
      isTable: (findings.charts ?? []).map((chart) => chart.type === 'table'),
    });

    return SpecSections.section({
      id: 'findings',
      title: chrome.findings,
      body: `${findings.numbers === undefined ? '' : ReportSectionsBuilder.tilesHtml({ tiles: findings.numbers, chrome })}${findings.charts === undefined ? '' : `<div class="charts">${findings.charts.map((chart, at) => SpecCharts.render({ chart, chrome, isWide: wideRows[at] })).join('')}</div>`}${findings.callouts === undefined ? '' : `<ul class="callouts">${findings.callouts.map((callout) => `<li class="callout c-${callout.state === undefined ? 'info' : NodeStates.toneOf(callout.state)}">${SpecCharts.stateIcon({ state: callout.state ?? 'info', size: 22 })}<p>${callout.state === undefined ? '' : `<span class="vh">${FigureLayout.escapeText({ value: SpecSections.stateWord({ chrome, state: callout.state }) })}: </span>`}${FigureLayout.escapeText({ value: callout.text })}</p></li>`).join('')}</ul>`}`,
    });
  }

  /** A grade for each area: a chip whose letter is always shown, so colour is never the only signal. */
  static grades(opts: { ctx: ISectionContext }): string {
    const { grades } = opts.ctx.spec;
    const { chrome } = opts.ctx;
    const tones: Record<string, string> = { A: 'ok', B: 'info', C: 'bad' };
    const words: Record<string, string> = { A: chrome.gradeA, B: chrome.gradeB, C: chrome.gradeC };

    if (grades === undefined) {
      return '';
    }

    return SpecSections.section({
      id: 'grades',
      title: chrome.grades,
      body: `<ul class="grades">${grades
        .map(
          (item) =>
            `<li><span class="gn">${FigureLayout.escapeText({ value: item.label })}</span><span class="gr c-${tones[item.grade]}"><b>${item.grade}</b>${FigureLayout.escapeText({ value: words[item.grade] ?? '' })}</span>${item.note === undefined ? '' : `<span class="gt">${FigureLayout.escapeText({ value: item.note })}</span>`}</li>`,
        )
        .join('')}</ul>`,
    });
  }

  /** Numbers as cards: the value, what it is of, and a bar split into its parts with a legend that says each. */
  static metrics(opts: { ctx: ISectionContext }): string {
    const { metrics } = opts.ctx.spec;
    const { chrome } = opts.ctx;

    if (metrics === undefined) {
      return '';
    }

    const card = (metric: NonNullable<TVisualizeSpec['metrics']>[number]): string => {
      const total = metric.parts.reduce((sum, part) => sum + part.value, 0);
      let at = 0;
      const rects = metric.parts.map((part) => {
        const width = (part.value / total) * 100;
        const rect = `<rect class="t-${part.tone}" x="${at.toFixed(2)}" width="${width.toFixed(2)}" height="8"/>`;

        at += width;

        return rect;
      });

      return `<li class="mc"><p class="mv">${FigureLayout.escapeText({ value: metric.value })}${metric.of === undefined ? '' : `<small>/ ${FigureLayout.escapeText({ value: metric.of })}</small>`}</p><p class="ml">${FigureLayout.escapeText({ value: metric.label })}</p>${metric.note === undefined ? '' : `<p class="mt">${FigureLayout.escapeText({ value: metric.note })}</p>`}<svg class="mb" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${FigureLayout.escapeText({ value: metric.parts.map((part) => `${part.label}: ${part.value}`).join(', ') })}">${rects.join('')}</svg><ul class="mlg">${metric.parts.map((part) => `<li><i class="sw t-${part.tone}"></i>${FigureLayout.escapeText({ value: part.label })}: ${part.value}</li>`).join('')}</ul></li>`;
    };

    return SpecSections.section({
      id: 'metrics',
      title: chrome.metrics,
      body: `<ul class="metrics">${metrics.map(card).join('')}</ul>`,
    });
  }

  /** The written sections: a typed list of blocks, each its own element, never parsed markup. */
  static notes(opts: { ctx: ISectionContext }): string {
    return (opts.ctx.spec.sections ?? [])
      .map((part, index) =>
        SpecSections.section({
          id: `note-${index + 1}`,
          title: part.title,
          body: `<div class="blk">${part.blocks.map((block) => blockHtml({ block })).join('')}</div>`,
        }),
      )
      .join('');
  }

  static evidence(opts: { ctx: ISectionContext }): string {
    const { evidence } = opts.ctx.spec;
    const { chrome } = opts.ctx;

    if (evidence === undefined) {
      return '';
    }

    return SpecSections.section({
      id: 'evidence',
      title: chrome.evidence,
      body: `<ul class="ledger">${evidence
        .map((row) => {
          const word =
            chrome.evidenceLabels[row.label as keyof TChrome['evidenceLabels']] ?? row.label;

          return `<li class="ev"><span class="badge ev-${FigureLayout.escapeText({ value: row.label })}">${IconSet.iconSvg({ name: row.label, size: 16 })}${FigureLayout.escapeText({ value: word })}</span><span class="cl"><b>${FigureLayout.escapeText({ value: row.claim })}</b><span class="pr">${FigureLayout.escapeText({ value: row.probe })}</span></span><span class="rs">${FigureLayout.escapeText({ value: row.result })}</span></li>`;
        })
        .join('')}</ul>`,
    });
  }

  static risks(opts: { ctx: ISectionContext }): string {
    const { risks } = opts.ctx.spec;
    const { chrome } = opts.ctx;

    if (risks === undefined) {
      return '';
    }

    return SpecSections.section({
      id: 'risks',
      title: chrome.risks,
      body: table({
        head: [chrome.risk, chrome.impact, chrome.fallback],
        rows: risks.map((row) => [
          cell({ value: row.risk, label: chrome.risk }),
          cell({ value: row.impact, label: chrome.impact }),
          cell({ value: row.fallback, label: chrome.fallback }),
        ]),
      }),
    });
  }

  static log(opts: { ctx: ISectionContext }): string {
    const { log } = opts.ctx.spec;

    return log === undefined
      ? ''
      : SpecSections.section({
          id: 'log',
          title: opts.ctx.chrome.log,
          body: `<ul class="log">${log.map((row) => `<li><time>${FigureLayout.escapeText({ value: row.date })}</time><span>${FigureLayout.escapeText({ value: row.text })}</span></li>`).join('')}</ul>`,
        });
  }

  static links(opts: { ctx: ISectionContext }): string {
    const { links } = opts.ctx.spec;

    return links === undefined
      ? ''
      : SpecSections.section({
          id: 'links',
          title: opts.ctx.chrome.links,
          body: `<ul class="links">${links.map((link) => `<li><a href="${FigureLayout.escapeText({ value: link.href })}" rel="noopener noreferrer"><span>${FigureLayout.escapeText({ value: link.label })}</span>${IconSet.iconSvg({ name: 'arrow', size: 18 })}</a></li>`).join('')}</ul>`,
        });
  }
}
