import { createHash } from 'node:crypto';
import { Assets, HEAD_JS, PAGE_JS } from './assets.ts';
import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import { IconSet } from './icons.ts';
import { SpecCharts } from './charts.ts';
import { COMPARE_CSS } from './compare-css.ts';
import { CompareView } from './compare-render.ts';
import { NEW_KINDS_CSS } from './kinds-css.ts';
import { KindsRender } from './kinds-render.ts';
import { Labels } from './labels.ts';
import { FIGURE_FIT, FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';
import { PageTerms, SourceRefs } from './sources.ts';
import { ProjectTheme } from './theme.ts';
import type { IResolvedTheme } from './theme.ts';
import { SpecSections } from './sections.ts';
import type { ISectionContext } from './sections.ts';

const escaped = (value: string): string => FigureLayout.escapeText({ value });

/** The mark of the top bar: a diamond in the hot colour. */
const MARK =
  '<svg class="mark" viewBox="0 0 14 18" aria-hidden="true"><path d="M7 0 14 9 7 18 0 9Z"/></svg>';

/** A figure is drawn at most this much larger than its natural width, so a short flow does not turn into a poster. */
const FIGURE_MAX = 1.25;

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
 * For each figure width: the size it may take (never under FIGURE_FIT of its natural width, never past a quarter more),
 * and the rule that swaps the figure for its list below the viewport width at which it would shrink under FIGURE_FIT
 * of its natural size (text under 12 px). The 66 is the page and frame padding.
 */
const figureFitCss = (opts: { widths: Set<number> }): string =>
  [...opts.widths]
    .sort((a, b) => a - b)
    .map((width) => {
      const at = Math.ceil(width * FIGURE_FIT) + 66;
      const least = Math.ceil(width * FIGURE_FIT);
      const most = Math.ceil(width * FIGURE_MAX);

      return `.fig.f${width} svg{min-width:${least}px;max-width:${most}px}\n@media (max-width:${at}px){.fig.f${width}{display:none}.fig.f${width}~.path,.fig.f${width}~.path-detail{display:block}.fig.f${width}~.say,.fig.f${width}~.legend{display:none}.fig.f${width}~.steps .explain{display:block}.fig.f${width}~.steps button{pointer-events:none}}`;
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
      label: SpecSections.stateWord({ chrome: opts.chrome, state: 'done' }),
      state: 'done',
    },
    {
      value: String(count('in progress')),
      label: SpecSections.stateWord({ chrome: opts.chrome, state: 'in progress' }),
      state: 'in progress',
    },
    {
      value: String(count('waiting')),
      label: SpecSections.stateWord({ chrome: opts.chrome, state: 'waiting' }),
      state: 'waiting',
    },
    {
      value: String(count('blocked')),
      label: SpecSections.stateWord({ chrome: opts.chrome, state: 'blocked' }),
      state: 'blocked',
    },
  ];
};

/** The state of the spec as the page says it: a minimap state for the icon, its tone, and the word. */
const stateOf = (opts: {
  spec: TVisualizeSpec;
  chrome: TChrome;
}): { state: string; tone: string; word: string } => {
  const { spec, chrome } = opts;
  const state = BANNER_STATE[spec.status.state] ?? 'info';
  const word =
    spec.status.label ??
    chrome.statusStates[spec.status.state as keyof TChrome['statusStates']] ??
    spec.status.state;

  return { state, tone: NodeStates.toneOf(state), word };
};

/** The always-dark hero: the state, the title, the verdict, the caption, and the flow when the spec has one. */
const heroHtml = (opts: { ctx: ISectionContext }): string => {
  const { spec, chrome } = opts.ctx;
  const { state, tone, word } = stateOf({ spec, chrome });
  const meta = [
    spec.asOf === undefined ? '' : `<span>${escaped(chrome.asOf)}: ${escaped(spec.asOf)}</span>`,
    spec.scope === undefined ? '' : `<span>${escaped(chrome.scope)}: ${escaped(spec.scope)}</span>`,
  ].join('');

  return `<div class="banner slab c-${tone}" data-slide data-hero><div class="wrap hero"><p class="state">${SpecCharts.stateIcon({ state, size: 22 })}<span class="word">${escaped(word)}</span></p><h1>${escaped(spec.title)}</h1><p class="lede">${escaped(spec.verdict)}</p>${spec.caption === undefined ? '' : `<p class="cap">${escaped(spec.caption)}</p>`}${meta === '' ? '' : `<p class="meta">${meta}</p>`}${SpecSections.flow({ ctx: opts.ctx })}</div></div>`;
};

/** The minimap as a track: a stripe, a shape and a word for every task. */
const stepperHtml = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { minimap } = opts.spec;

  if (minimap === undefined) {
    return '';
  }

  const { chrome } = opts;

  return `<section class="part" id="minimap" data-slide><div class="wrap"><h2 class="sh">${escaped(chrome.minimap)}</h2><ol class="strip">${minimap
    .map(
      (row) =>
        `<li class="seg c-${NodeStates.toneOf(row.status)}"><span class="bar"></span><span class="nm">${SpecSections.chip({ chrome, state: row.status })}<span class="tn">${escaped(row.task)}</span></span>${row.note === undefined ? '' : `<span class="nt">${escaped(row.note)}</span>`}</li>`,
    )
    .join('')}</ol></div></section>`;
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

  return `<section class="two" id="next" data-slide><div class="wrap"><div class="own"><div class="nx"><p class="lab">${escaped(chrome.next)}</p><h2>${escaped(spec.strip.next)}</h2>${actions}${jump}</div><div class="stop"><p class="lab">${escaped(chrome.blockedBy)}</p><p>${escaped(spec.strip.blockedBy)}</p></div></div><div class="facts"><p class="fact">${IconSet.iconSvg({ name: 'done', size: 18 })}<span><b>${escaped(chrome.healthy)}</b> ${escaped(spec.strip.healthy)}</span></p><p class="fact">${IconSet.iconSvg({ name: 'info', size: 18 })}<span><b>${escaped(chrome.changed)}</b> ${escaped(spec.strip.changed)}</span></p></div></div></section>`;
};

/** The neutral theme of a page that is given none. */
const NEUTRAL = ((): IResolvedTheme => {
  const resolved = ProjectTheme.resolve({});

  if (!resolved.ok) {
    throw new Error(
      `the neutral theme does not pass its own checks: ${resolved.problems.join('; ')}`,
    );
  }

  return resolved.theme;
})();

export class PageShell {
  /** The whole page: one file, no network, a content-security policy that allows only the page's own style and scripts by hash. */
  static render(opts: {
    spec: TVisualizeSpec;
    /** The page's language: the spec's, else the owner's profile, else English. */
    language?: string;
    /** The checked colours of the page; the stylesheet takes its tokens from them. */
    theme?: IResolvedTheme;
  }): string {
    const { spec } = opts;
    const language = opts.language ?? spec.language ?? 'en';
    const chrome = Labels.chromeOf({ spec, language });
    const ctx: ISectionContext = { spec, chrome, fits: new Set<number>() };
    const { state, tone, word } = stateOf({ spec, chrome });
    const sources = SourceRefs.entries({ spec, chrome });
    const tiles =
      spec.tiles ?? (spec.minimap === undefined ? undefined : countTiles({ spec, chrome }));
    const body = [
      heroHtml({ ctx }),
      tiles === undefined
        ? ''
        : `<div data-slide class="slide-tiles"><div class="wrap">${SpecSections.tilesHtml({ tiles, chrome })}</div></div>`,
      stepperHtml({ spec, chrome }),
      ownerHtml({ spec, chrome }),
      SpecSections.architecture({ ctx }),
      CompareView.section({ ctx }),
      KindsRender.sequenceSection({ ctx }),
      KindsRender.lifecycleSection({ ctx }),
      KindsRender.treeSection({ ctx }),
      SpecSections.comparison({ ctx }),
      SpecSections.ideaMap({ ctx }),
      SpecSections.explainer({ ctx }),
      SpecSections.timeline({ ctx }),
      SpecSections.findings({ ctx }),
      SpecSections.beforeAfter({ ctx }),
      SpecSections.decisionRecord({ ctx }),
      SpecSections.decisions({ ctx }),
      SpecSections.evidence({ ctx }),
      SpecSections.risks({ ctx }),
      SpecSections.log({ ctx }),
      spec.terms === undefined
        ? ''
        : SpecSections.section({
            id: 'terms',
            title: chrome.terms,
            body: PageTerms.listHtml({ terms: spec.terms }),
          }),
      sources.length === 0
        ? ''
        : SpecSections.section({
            id: 'sources',
            title: chrome.sources,
            body: SourceRefs.listHtml({ entries: sources }),
          }),
      SpecSections.links({ ctx }),
    ].join('');
    const css = `${Assets.pageCss({ tokens: ProjectTheme.tokensCss({ theme: opts.theme ?? NEUTRAL }) })}\n${NEW_KINDS_CSS}\n${COMPARE_CSS}\n${figureFitCss({ widths: ctx.fits })}`;
    const policy = `default-src 'none'; style-src ${sha256({ text: css })}; script-src ${sha256({ text: HEAD_JS })} ${sha256({ text: PAGE_JS })}; base-uri 'none'; form-action 'none'`;
    const links = SpecSections.sectionLinks({ spec, chrome })
      .map((link) => `<a href="#${link.id}">${escaped(link.title)}</a>`)
      .join('');
    const stamp =
      spec.asOf === undefined
        ? ''
        : `<span class="sep" aria-hidden="true"></span><span class="stamp">${escaped(spec.asOf)}</span>`;
    const bar = `<header class="top slab c-${tone}"><div class="wrap">${MARK}<b class="ttl">${escaped(spec.title)}</b>${SpecSections.chip({ chrome, state, size: 18, label: word })}<nav aria-label="${escaped(chrome.navLabel)}"><span class="links">${links}</span>${stamp}<span class="sep" aria-hidden="true"></span><button class="btn js-only" id="present" type="button" data-on="${escaped(chrome.present)}" data-off="${escaped(chrome.exitPresent)}">${escaped(chrome.present)}</button><button class="theme" id="theme" type="button" aria-label="${escaped(chrome.themeToDark)}" data-to-light="${escaped(chrome.themeToLight)}" data-to-dark="${escaped(chrome.themeToDark)}">${IconSet.iconSvg({ name: 'sun', size: 20, className: 'sun' })}${IconSet.iconSvg({ name: 'moon', size: 20, className: 'moon' })}<span class="tip" aria-hidden="true"></span></button></nav></div></header>`;
    const deck = `<nav class="deck" aria-label="${escaped(chrome.slide)}"><button class="btn" id="slide-prev" type="button">${escaped(chrome.previous)}</button><span id="slide-count" aria-live="polite"></span><button class="btn" id="slide-next" type="button">${escaped(chrome.following)}</button></nav>`;

    return `<!doctype html><html lang="${escaped(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${escaped(policy)}"><meta name="generator" content="vulcan visualize"><title>${escaped(spec.title)}</title><script>${HEAD_JS}</script><style>${css}</style></head><body>${bar}<main>${body}</main><footer class="slab foot"><div class="wrap"><p>${escaped(chrome.footer)}</p></div></footer>${deck}<script>${PAGE_JS}</script></body></html>`;
  }
}
