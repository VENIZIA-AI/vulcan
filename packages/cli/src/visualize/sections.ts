import { renderChart, renderTotals, stateIcon, formatNumber } from './charts.ts';
import { ChangeKinds, MinimapStates, NodeStates } from './constants.ts';
import type { TChangeKind, TChrome } from './constants.ts';
import { renderArchitecture, renderDiagram, renderIdeaMap } from './diagrams.ts';
import type { IDrawing } from './diagrams.ts';
import { iconSvg } from './icons.ts';
import { columnsOf, escapeText, figureWidth, renderFigure, renderPathList } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';
import { SourceRefs } from './sources.ts';

/** What every section needs: the spec, the page's words, and the widths of the figures that must give way to a list on a phone. */
export interface ISectionContext {
  spec: TVisualizeSpec;
  chrome: TChrome;
  fits: Set<number>;
}

const escaped = (value: string): string => escapeText({ value });

/** The word of a state in the page's language. */
export const stateWord = (opts: { chrome: TChrome; state: string }): string => {
  const key = MinimapStates.keyOf(opts.state) as keyof TChrome['minimapStates'];

  return opts.chrome.minimapStates[key] ?? opts.state;
};

/** A state as an icon and a word. */
export const chip = (opts: {
  chrome: TChrome;
  state: string;
  size?: number;
  label?: string;
}): string =>
  `<span class="chip c-${NodeStates.toneOf(opts.state)}">${stateIcon({ state: opts.state, size: opts.size ?? 16 })}<span>${escaped(opts.label ?? stateWord(opts))}</span></span>`;

/** A part of the page: its title, then its body, each part a slide of its own. */
export const section = (opts: {
  id: string;
  title: string;
  body: string;
  extra?: string;
}): string =>
  `<section class="part${opts.extra === undefined ? '' : ` ${opts.extra}`}" id="${opts.id}" data-slide><div class="wrap"><h2 class="sh">${escaped(opts.title)}</h2>${opts.body}</div></section>`;

/** The in-page links of the top bar: the parts that exist, in the order of the page. */
export const sectionLinks = (opts: {
  spec: TVisualizeSpec;
  chrome: TChrome;
}): { id: string; title: string }[] => {
  const { spec, chrome } = opts;
  const parts: [boolean, string, string][] = [
    [spec.flow !== undefined, 'flow', chrome.flow],
    [spec.minimap !== undefined, 'minimap', chrome.minimap],
    [spec.strip !== undefined, 'next', chrome.next],
    [spec.architecture !== undefined, 'architecture', chrome.architecture],
    [spec.compare !== undefined, 'compare', chrome.compareView],
    [spec.sequence !== undefined, 'sequence', chrome.sequence],
    [spec.lifecycle !== undefined, 'lifecycle', chrome.lifecycle],
    [spec.tree !== undefined, 'tree', chrome.tree],
    [spec.comparison !== undefined, 'comparison', chrome.comparison],
    [spec.ideaMap !== undefined, 'idea-map', chrome.ideaMap],
    [spec.explainer !== undefined, 'explainer', chrome.explainer],
    [spec.timeline !== undefined, 'timeline', chrome.timeline],
    [spec.findings !== undefined, 'findings', chrome.findings],
    [spec.beforeAfter !== undefined, 'before-after', `${chrome.before} / ${chrome.after}`],
    [spec.decisionRecord !== undefined, 'decision-record', chrome.decisionRecord],
    [spec.decisions !== undefined, 'decisions', chrome.decisions],
    [spec.evidence !== undefined, 'evidence', chrome.evidence],
    [spec.risks !== undefined, 'risks', chrome.risks],
    [spec.log !== undefined, 'log', chrome.log],
    [spec.terms !== undefined, 'terms', chrome.terms],
    [SourceRefs.entries({ spec, chrome }).length > 0, 'sources', chrome.sources],
    [spec.links !== undefined, 'links', chrome.links],
  ];

  return parts.filter(([exists]) => exists).map(([, id, title]) => ({ id, title }));
};

/** A drawing in a dark window; below the width where its text would pass 12 px the list takes its place. */
export const figure = (opts: { ctx: ISectionContext; drawing: IDrawing }): string => {
  const width = Math.round(opts.drawing.width);

  opts.ctx.fits.add(width);

  return `<div class="win"><div class="fig f${width}">${opts.drawing.svg}</div>${opts.drawing.fallback}</div>`;
};

/** JSON for a `<script type="application/json">`: nothing in it can close the tag or start a comment. */
export const jsonForScript = (opts: { value: unknown }): string =>
  JSON.stringify(opts.value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');

/** One variant of an arrow as a short line, drawn with the same rules as the arrows of the figure. */
const variantSwatch = (opts: { variant: string }): string =>
  `<svg class="lg" viewBox="0 0 44 12" aria-hidden="true"><g class="edge ${escaped(opts.variant)}"><path d="M0 6H44"/></g></svg>`;

/**
 * The flow lives in the hero: the figure on the slab, its phone list, the legend, then the steps to press and the
 * line that says what is picked. Without script the steps are a plain list with their text.
 */
export const flowSection = (opts: { ctx: ISectionContext }): string => {
  const { flow } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (flow === undefined) {
    return '';
  }

  const width = figureWidth({ cols: columnsOf({ flow }) });
  const kinds = [...new Set(flow.nodes.map((node) => node.kind ?? 'step'))];
  const variants = [...new Set(flow.edges.map((edge) => edge.variant ?? 'main'))];
  const states = [
    ...new Set(flow.nodes.flatMap((node) => (node.state === undefined ? [] : [node.state]))),
  ];
  const steps = flow.steps;
  const legend = [
    ...states.map((state) => `<li>${chip({ chrome, state })}</li>`),
    ...(kinds.length > 1 ? kinds.map((kind) => `<li>${escaped(kind)}</li>`) : []),
    ...(variants.length > 1
      ? variants.map(
          (variant) => `<li>${variantSwatch({ variant })}<span>${escaped(variant)}</span></li>`,
        )
      : []),
  ];
  const play =
    flow.edges.length > 0
      ? `<button class="btn" id="play" type="button" aria-pressed="false" data-play="${escaped(chrome.play)}" data-pause="${escaped(chrome.pause)}">${escaped(chrome.play)}</button>`
      : '';
  const all =
    steps.length > 0
      ? `<button class="btn" id="all" type="button" hidden>${escaped(chrome.allSteps)}</button>`
      : '';

  opts.ctx.fits.add(width);

  // A box that has a source says it in its detail line: on hover, and in the phone list.
  const shown = {
    ...flow,
    nodes: flow.nodes.map((node) =>
      node.source === undefined
        ? node
        : {
            ...node,
            detail: SourceRefs.withSource({
              text: node.detail ?? node.sublabel,
              source: node.source,
            }),
          },
    ),
  };
  // The script reads the step's note whole: its source goes after it there, and in the markup it is its own element.
  const stepsJson = steps.map((step) =>
    step.source === undefined
      ? step
      : {
          title: step.title,
          note: SourceRefs.withSource({ text: step.note, source: step.source }),
          nodes: step.nodes,
          edges: step.edges,
        },
  );

  // The figure, its phone list, the legend, then the steps: a sibling order the page CSS relies on to swap the figure for the list.
  return `<figure class="figure" id="flow"><p class="lab">${escaped(chrome.flow)}</p><div class="fig f${width}">${renderFigure({ flow: shown })}</div>${renderPathList({ flow: shown })}${
    legend.length === 0 ? '' : `<ul class="legend">${legend.join('')}</ul>`
  }${
    steps.length > 0
      ? `<ol class="steps">${steps.map((step, index) => `<li><button type="button" aria-pressed="false"><b>${escaped(step.title)}</b><span>${index + 1} / ${steps.length}</span></button><p class="explain">${escaped(step.note)}${step.source === undefined ? '' : ` ${SourceRefs.html({ source: step.source })}`}</p></li>`).join('')}</ol>`
      : ''
  }<div class="say js-only"><p id="say" aria-live="polite">${escaped(chrome.detailHint)}</p><div class="ctl">${play}${all}</div></div>${
    steps.length > 0
      ? `<script type="application/json" id="steps">${jsonForScript({ value: stepsJson })}</script>`
      : ''
  }</figure>`;
};

export const architectureSection = (opts: { ctx: ISectionContext }): string => {
  const { architecture } = opts.ctx.spec;

  if (architecture === undefined) {
    return '';
  }

  return section({
    id: 'architecture',
    title: opts.ctx.chrome.architecture,
    body: figure({
      ctx: opts.ctx,
      drawing: renderArchitecture({ architecture, chrome: opts.ctx.chrome }),
    }),
  });
};

const dots = (opts: { score: number }): string =>
  `<span class="dots" role="img" aria-label="${opts.score} / 5">${Array.from({ length: 5 }, (_, index) => `<i${index < opts.score ? ' class="on"' : ''}></i>`).join('')}</span>`;

export const comparisonSection = (opts: { ctx: ISectionContext }): string => {
  const { comparison } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (comparison === undefined) {
    return '';
  }

  const totals = comparison.options.map((option) =>
    option.scores.reduce((sum, score) => sum + score, 0),
  );
  const marked = comparison.options.findIndex((option) => option.recommended === true);
  const best = marked === -1 ? totals.indexOf(Math.max(...totals)) : marked;
  const max = comparison.criteria.length * 5;
  const cards = comparison.options
    .map(
      (option, index) =>
        `<article class="opt${option.recommended === true ? ' rec' : ''}">${option.recommended === true ? `<span class="tag">${escaped(chrome.recommended)}</span>` : ''}<p class="tot">${totals[index]}<small> ${escaped(chrome.outOf)} ${max}</small></p><h3>${escaped(option.name)}</h3>${option.line === undefined ? '' : `<p class="ln">${escaped(option.line)}</p>`}<div class="crit">${comparison.criteria.map((criterion, i) => `<div><span>${escaped(criterion)}</span>${dots({ score: option.scores[i] ?? 0 })}</div>`).join('')}</div><ul class="pc">${(option.pros ?? []).map((pro) => `<li class="p">${iconSvg({ name: 'plus', size: 16 })}<span><span class="vh">${escaped(chrome.pros)}: </span>${escaped(pro)}</span></li>`).join('')}${(option.cons ?? []).map((con) => `<li class="c">${iconSvg({ name: 'minus', size: 16 })}<span><span class="vh">${escaped(chrome.cons)}: </span>${escaped(con)}</span></li>`).join('')}</ul></article>`,
    )
    .join('');

  return section({
    id: 'comparison',
    title: chrome.comparison,
    body: `<div class="ranks"><p class="lab">${escaped(chrome.total)}, ${escaped(chrome.outOf)} ${max}</p>${renderTotals({ names: comparison.options.map((option) => option.name), totals, best, max, chrome })}</div><div class="opts n${comparison.options.length}">${cards}</div>${comparison.note === undefined ? '' : `<p class="note">${iconSvg({ name: 'info', size: 16 })} ${escaped(comparison.note)}</p>`}`,
  });
};

export const ideaMapSection = (opts: { ctx: ISectionContext }): string => {
  const { ideaMap } = opts.ctx.spec;

  return ideaMap === undefined
    ? ''
    : section({
        id: 'idea-map',
        title: opts.ctx.chrome.ideaMap,
        body: renderIdeaMap({ map: ideaMap }),
      });
};

export const explainerSection = (opts: { ctx: ISectionContext }): string => {
  const { explainer } = opts.ctx.spec;

  if (explainer === undefined) {
    return '';
  }

  return section({
    id: 'explainer',
    title: opts.ctx.chrome.explainer,
    body: `<ol class="ex">${explainer.steps
      .map(
        (step, index) =>
          `<li class="estep"><span class="no">${index + 1}</span><div class="sb"><h3>${escaped(step.title)}</h3><p>${escaped(step.text)}</p></div>${step.diagram === undefined ? '' : `<div class="dg">${figure({ ctx: opts.ctx, drawing: renderDiagram({ diagram: step.diagram }) })}</div>`}</li>`,
      )
      .join('')}</ol>`,
  });
};

export const timelineSection = (opts: { ctx: ISectionContext }): string => {
  const { timeline } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (timeline === undefined) {
    return '';
  }

  return section({
    id: 'timeline',
    title: chrome.timeline,
    body: `<ol class="tl">${timeline.items
      .map(
        (item) =>
          `<li class="c-${item.state === undefined ? 'mut' : NodeStates.toneOf(item.state)}"><span class="dot">${item.state === undefined ? '' : stateIcon({ state: item.state, size: 18 })}</span><time>${escaped(item.date)}</time><h3>${escaped(item.title)}</h3>${item.state === undefined ? '' : `<span class="vh">${escaped(stateWord({ chrome, state: item.state }))}</span>`}${item.text === undefined ? '' : `<p>${escaped(item.text)}</p>`}</li>`,
      )
      .join('')}</ol>`,
  });
};

/** Big numbers as fields: a tint and an icon for a state, plain for a number that is only a number. */
export const tilesHtml = (opts: {
  tiles: { value: string; label: string; state?: string }[];
  chrome: TChrome;
}): string =>
  `<ul class="tiles" aria-label="${escaped(opts.chrome.findings)}">${opts.tiles
    .map(
      (tile) =>
        `<li class="tile${tile.state === undefined ? '' : ` c-${NodeStates.toneOf(tile.state)}`}">${tile.state === undefined ? '' : stateIcon({ state: tile.state, size: 22 })}<span class="n">${escaped(tile.value)}</span><span class="l">${escaped(tile.label)}</span>${tile.state === undefined ? '' : `<span class="vh">${escaped(stateWord({ chrome: opts.chrome, state: tile.state }))}</span>`}</li>`,
    )
    .join('')}</ul>`;

export const findingsSection = (opts: { ctx: ISectionContext }): string => {
  const { findings } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (findings === undefined) {
    return '';
  }

  return section({
    id: 'findings',
    title: chrome.findings,
    body: `${findings.numbers === undefined ? '' : tilesHtml({ tiles: findings.numbers, chrome })}${findings.charts === undefined ? '' : `<div class="charts">${findings.charts.map((chart) => renderChart({ chart, chrome })).join('')}</div>`}${findings.callouts === undefined ? '' : `<ul class="callouts">${findings.callouts.map((callout) => `<li class="callout c-${callout.state === undefined ? 'info' : NodeStates.toneOf(callout.state)}">${stateIcon({ state: callout.state ?? 'info', size: 22 })}<p>${callout.state === undefined ? '' : `<span class="vh">${escaped(stateWord({ chrome, state: callout.state }))}: </span>`}${escaped(callout.text)}</p></li>`).join('')}</ul>`}`,
  });
};

export const beforeAfterSection = (opts: { ctx: ISectionContext }): string => {
  const { beforeAfter } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (beforeAfter === undefined) {
    return '';
  }

  const side = (given: {
    title: string;
    items: { text: string; change?: string }[];
    kind: TChangeKind;
  }): string =>
    `<section class="ba"><h3>${escaped(given.title)}</h3><ul>${given.items
      .map((item) =>
        item.change === given.kind
          ? `<li class="${given.kind === ChangeKinds.ADDED ? 'add' : 'del'}">${iconSvg({ name: given.kind === ChangeKinds.ADDED ? 'plus' : 'minus', size: 16 })}<span><b class="wd">${escaped(given.kind === ChangeKinds.ADDED ? chrome.added : chrome.removed)}</b><span class="tx">${escaped(item.text)}</span></span></li>`
          : `<li class="same">${iconSvg({ name: 'minus', size: 16 })}<span>${escaped(item.text)}</span></li>`,
      )
      .join('')}</ul></section>`;

  return section({
    id: 'before-after',
    title: `${chrome.before} / ${chrome.after}`,
    body: `<div class="diff">${side({ ...beforeAfter.before, kind: ChangeKinds.REMOVED })}${side({ ...beforeAfter.after, kind: ChangeKinds.ADDED })}</div>`,
  });
};

export const decisionRecordSection = (opts: { ctx: ISectionContext }): string => {
  const { decisionRecord } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (decisionRecord === undefined) {
    return '';
  }

  return section({
    id: 'decision-record',
    title: chrome.decisionRecord,
    body: `<div class="dr"><div><p class="lab">${escaped(chrome.context)}</p><p class="ctx">${escaped(decisionRecord.context)}</p></div><div><p class="lab">${escaped(chrome.optionsConsidered)}</p><div class="opts n${decisionRecord.options.length}">${decisionRecord.options
      .map(
        (option) =>
          `<article class="opt${option.chosen === true ? ' rec' : ''}">${option.chosen === true ? `<span class="tag">${escaped(chrome.chosen)}</span>` : ''}<h3>${escaped(option.name)}</h3><p class="ln">${escaped(option.summary)}</p></article>`,
      )
      .join(
        '',
      )}</div></div><blockquote class="pull">${iconSvg({ name: 'quote', size: 36 })}<p class="lab">${escaped(chrome.decision)}</p><p class="big">${escaped(decisionRecord.decision)}</p></blockquote><div><p class="lab">${escaped(chrome.consequences)}</p><ul class="cons">${decisionRecord.consequences.map((consequence) => `<li>${iconSvg({ name: 'check', size: 18 })}<span>${escaped(consequence)}</span></li>`).join('')}</ul></div></div>`,
  });
};

export const decisionsSection = (opts: { ctx: ISectionContext }): string => {
  const { decisions } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (decisions === undefined) {
    return '';
  }

  return section({
    id: 'decisions',
    title: chrome.decisions,
    body: `<ol class="qs">${decisions
      .map(
        (item) =>
          `<li class="q"><div><h3>${escaped(item.question)}</h3><p class="chg"><span class="lab">${escaped(chrome.changesClaim)}</span>${escaped(item.changes)}</p></div><div class="rec"><b>${escaped(chrome.recommended)}</b><strong>${escaped(item.recommended)}</strong></div></li>`,
      )
      .join('')}</ol>`,
  });
};

const table = (opts: { head: string[]; rows: string[][] }): string =>
  `<div class="tw"><table class="stack"><thead><tr>${opts.head.map((cell) => `<th>${escaped(cell)}</th>`).join('')}</tr></thead><tbody>${opts.rows.map((row) => `<tr>${row.join('')}</tr>`).join('')}</tbody></table></div>`;

const cell = (opts: { value: string; label?: string; tag?: boolean }): string =>
  `<td${opts.tag === true ? ' class="tag"' : ''}${opts.label === undefined ? '' : ` data-label="${escaped(opts.label)}"`}>${escaped(opts.value)}</td>`;

export const evidenceSection = (opts: { ctx: ISectionContext }): string => {
  const { evidence } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (evidence === undefined) {
    return '';
  }

  return section({
    id: 'evidence',
    title: chrome.evidence,
    body: `<ul class="ledger">${evidence
      .map((row) => {
        const word =
          chrome.evidenceLabels[row.label as keyof TChrome['evidenceLabels']] ?? row.label;

        return `<li class="ev"><span class="badge ev-${escaped(row.label)}">${iconSvg({ name: row.label, size: 16 })}${escaped(word)}</span><span class="cl"><b>${escaped(row.claim)}</b><span class="pr">${escaped(row.probe)}</span></span><span class="rs">${escaped(row.result)}</span></li>`;
      })
      .join('')}</ul>`,
  });
};

export const risksSection = (opts: { ctx: ISectionContext }): string => {
  const { risks } = opts.ctx.spec;
  const { chrome } = opts.ctx;

  if (risks === undefined) {
    return '';
  }

  return section({
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
};

export const logSection = (opts: { ctx: ISectionContext }): string => {
  const { log } = opts.ctx.spec;

  return log === undefined
    ? ''
    : section({
        id: 'log',
        title: opts.ctx.chrome.log,
        body: `<ul class="log">${log.map((row) => `<li><time>${escaped(row.date)}</time><span>${escaped(row.text)}</span></li>`).join('')}</ul>`,
      });
};

export const linksSection = (opts: { ctx: ISectionContext }): string => {
  const { links } = opts.ctx.spec;

  return links === undefined
    ? ''
    : section({
        id: 'links',
        title: opts.ctx.chrome.links,
        body: `<ul class="links">${links.map((link) => `<li><a href="${escaped(link.href)}" rel="noopener noreferrer"><span>${escaped(link.label)}</span>${iconSvg({ name: 'arrow', size: 18 })}</a></li>`).join('')}</ul>`,
      });
};

export { formatNumber };
