import { createHash } from 'node:crypto';
import { PAGE_CSS, PAGE_JS } from './assets.ts';
import { DEFAULT_CHROME, NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import { iconSvg } from './icons.ts';
import { stateIcon } from './charts.ts';
import { escapeText, FIGURE_FIT } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';
import {
  architectureSection,
  beforeAfterSection,
  chip,
  comparisonSection,
  decisionRecordSection,
  decisionsSection,
  evidenceSection,
  explainerSection,
  findingsSection,
  flowSection,
  ideaMapSection,
  linksSection,
  logSection,
  risksSection,
  stateWord,
  tilesHtml,
  timelineSection,
} from './sections.ts';
import type { ISectionContext } from './sections.ts';

const escaped = (value: string): string => escapeText({ value });

const definedOnly = (opts: {
  value: Record<string, string | undefined> | undefined;
}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(opts.value ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/** The strings of the page: English, with whatever the spec replaces. */
export const chromeOf = (opts: { spec: TVisualizeSpec }): TChrome => {
  const given = opts.spec.chrome ?? {};
  const merged: Record<string, unknown> = { ...DEFAULT_CHROME };

  for (const [key, value] of Object.entries(given)) {
    if (typeof value === 'string') {
      merged[key] = value;
    }
  }

  return {
    ...DEFAULT_CHROME,
    ...Object.fromEntries(Object.entries(merged).filter(([, value]) => typeof value === 'string')),
    statusStates: { ...DEFAULT_CHROME.statusStates, ...definedOnly({ value: given.statusStates }) },
    minimapStates: {
      ...DEFAULT_CHROME.minimapStates,
      ...definedOnly({ value: given.minimapStates }),
    },
    evidenceLabels: {
      ...DEFAULT_CHROME.evidenceLabels,
      ...definedOnly({ value: given.evidenceLabels }),
    },
  };
};

const sha256 = (opts: { text: string }): string =>
  `'sha256-${createHash('sha256').update(opts.text).digest('base64')}'`;

/** The state each status of the spec reads as: a shape, a colour and a word. */
const BANNER_STATE: Record<string, string> = {
  ok: 'done',
  warn: 'waiting',
  blocked: 'blocked',
  info: 'info',
};

/**
 * For each figure width, the rule that swaps the figure for its list: below the viewport width at which the figure would
 * shrink under FIGURE_FIT of its natural size (text under 12 px). The 66 is the page and frame padding.
 */
export const figureFitCss = (opts: { widths: Set<number> }): string =>
  [...opts.widths]
    .sort((a, b) => a - b)
    .map((width) => {
      const at = Math.ceil(width * FIGURE_FIT) + 66;

      return `@media (max-width:${at}px){.fig.f${width}{display:none}.fig.f${width}~.path,.fig.f${width}~.path-detail{display:block}.fig.f${width}~.bar,.fig.f${width}~#detail,.fig.f${width}~.legend{display:none}}`;
    })
    .join('\n');

/** Counts of each minimap state, as tiles: how many tasks are done, in progress, waiting and blocked. */
const countTiles = (opts: {
  spec: TVisualizeSpec;
  chrome: TChrome;
}): { value: string; label: string; state: string }[] => {
  const rows = opts.spec.minimap ?? [];
  const count = (state: string): number => rows.filter((row) => row.status === state).length;

  return [
    {
      value: `${count('done')} / ${rows.length}`,
      label: stateWord({ chrome: opts.chrome, state: 'done' }),
      state: 'done',
    },
    {
      value: String(count('in progress')),
      label: stateWord({ chrome: opts.chrome, state: 'in progress' }),
      state: 'in progress',
    },
    {
      value: String(count('waiting')),
      label: stateWord({ chrome: opts.chrome, state: 'waiting' }),
      state: 'waiting',
    },
    {
      value: String(count('blocked')),
      label: stateWord({ chrome: opts.chrome, state: 'blocked' }),
      state: 'blocked',
    },
  ];
};

const bannerHtml = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { spec, chrome } = opts;
  const state = BANNER_STATE[spec.status.state] ?? 'info';
  const word =
    spec.status.label ??
    chrome.statusStates[spec.status.state as keyof TChrome['statusStates']] ??
    spec.status.state;
  const meta = [
    spec.asOf === undefined ? '' : `<span>${escaped(chrome.asOf)}: ${escaped(spec.asOf)}</span>`,
    spec.scope === undefined ? '' : `<span>${escaped(chrome.scope)}: ${escaped(spec.scope)}</span>`,
  ].join('');

  return `<header class="banner c-${NodeStates.toneOf(state)}" data-slide data-hero><div class="b-ic">${stateIcon({ state, size: 52 })}</div><div class="b-tx"><p class="meta">${meta}</p><p class="word">${escaped(word)}</p><h1>${escaped(spec.title)}</h1><p class="verdict">${escaped(spec.verdict)}</p>${spec.caption === undefined ? '' : `<p class="cap">${escaped(spec.caption)}</p>`}</div></header>`;
};

const stepperHtml = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { minimap } = opts.spec;

  if (minimap === undefined) {
    return '';
  }

  const { chrome } = opts;

  return `<section class="sec" id="minimap" data-slide><h2 class="lab">${escaped(chrome.minimap)}</h2><ol class="strip">${minimap
    .map(
      (row) =>
        `<li class="seg c-${NodeStates.toneOf(row.status)}"><span class="bar"></span><span class="nm">${chip({ chrome, state: row.status })}<span class="tn">${escaped(row.task)}</span></span>${row.note === undefined ? '' : `<span class="nt">${escaped(row.note)}</span>`}</li>`,
    )
    .join('')}</ol></section>`;
};

/** What the owner has to do and what blocks it: the first thing after the verdict. */
const ownerHtml = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { spec, chrome } = opts;

  if (spec.strip === undefined) {
    return '';
  }

  const jump =
    spec.decisions === undefined
      ? ''
      : `<a class="jump" href="#decisions">${escaped(chrome.decisions)} (${spec.decisions.length})</a>`;
  const actions =
    spec.actions === undefined
      ? ''
      : `<ol class="check">${spec.actions.map((action) => `<li>${escaped(action)}</li>`).join('')}</ol>`;

  return `<section class="two" data-slide><div class="card action"><p class="lab">${escaped(chrome.next)}</p><h2>${escaped(spec.strip.next)}</h2>${actions}${jump}</div><div class="card blocked"><p class="lab">${escaped(chrome.blockedBy)}</p><p class="bb">${iconSvg({ name: 'waiting', size: 20 })}<span>${escaped(spec.strip.blockedBy)}</span></p><p class="ok-line">${iconSvg({ name: 'done', size: 16 })}<span><b>${escaped(chrome.healthy)}</b> ${escaped(spec.strip.healthy)}</span></p><p class="ok-line">${iconSvg({ name: 'info', size: 16 })}<span><b>${escaped(chrome.changed)}</b> ${escaped(spec.strip.changed)}</span></p></div></section>`;
};

/** The whole page: one file, no network, a content-security policy that allows only the page's own style and script by hash. */
export const renderPage = (opts: { spec: TVisualizeSpec }): string => {
  const { spec } = opts;
  const chrome = chromeOf({ spec });
  const ctx: ISectionContext = { spec, chrome, fits: new Set<number>() };
  const state = BANNER_STATE[spec.status.state] ?? 'info';
  const word =
    spec.status.label ??
    chrome.statusStates[spec.status.state as keyof TChrome['statusStates']] ??
    spec.status.state;
  const tiles =
    spec.tiles ?? (spec.minimap === undefined ? undefined : countTiles({ spec, chrome }));
  const body = [
    bannerHtml({ spec, chrome }),
    tiles === undefined
      ? ''
      : `<div data-slide class="slide-tiles">${tilesHtml({ tiles, chrome })}</div>`,
    stepperHtml({ spec, chrome }),
    ownerHtml({ spec, chrome }),
    flowSection({ ctx }),
    architectureSection({ ctx }),
    comparisonSection({ ctx }),
    ideaMapSection({ ctx }),
    explainerSection({ ctx }),
    timelineSection({ ctx }),
    findingsSection({ ctx }),
    beforeAfterSection({ ctx }),
    decisionRecordSection({ ctx }),
    decisionsSection({ ctx }),
    evidenceSection({ ctx }),
    risksSection({ ctx }),
    logSection({ ctx }),
    linksSection({ ctx }),
  ].join('');
  const css = `${PAGE_CSS}\n${figureFitCss({ widths: ctx.fits })}`;
  const policy = `default-src 'none'; style-src ${sha256({ text: css })}; script-src ${sha256({ text: PAGE_JS })}; base-uri 'none'; form-action 'none'`;
  const mini = `<div class="mini c-${NodeStates.toneOf(state)}" role="banner">${chip({ chrome, state, size: 18, label: word })}<b>${escaped(spec.title)}</b></div>`;
  const tools = `<div class="tools"><button id="present" type="button" data-on="${escaped(chrome.present)}" data-off="${escaped(chrome.exitPresent)}">${escaped(chrome.present)}</button><button id="theme" type="button">${escaped(chrome.theme)}</button></div>`;
  const deck = `<nav class="deck" aria-label="${escaped(chrome.slide)}"><button id="slide-prev" type="button">${escaped(chrome.previous)}</button><span id="slide-count" aria-live="polite"></span><button id="slide-next" type="button">${escaped(chrome.following)}</button></nav>`;

  return `<!doctype html><html lang="${escaped(spec.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escaped(policy)}"><meta name="generator" content="vulcan visualize"><title>${escaped(spec.title)}</title><style>${css}</style></head><body>${mini}<main class="wrap">${tools}${body}<footer>${escaped(chrome.footer)}</footer></main>${deck}<script>${PAGE_JS}</script></body></html>`;
};
