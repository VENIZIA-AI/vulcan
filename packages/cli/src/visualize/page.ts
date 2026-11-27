import { createHash } from 'node:crypto';
import { Assets, HEAD_JS, PAGE_JS } from './assets.ts';
import type { TChrome } from './constants.ts';
import { IconSet } from './icons.ts';
import { COMPARE_CSS } from './compare-css.ts';
import { CompareView } from './compare-render.ts';
import { NEW_KINDS_CSS } from './kinds-css.ts';
import { KindsRender } from './kinds-render.ts';
import { GridSpans } from './grid-span.ts';
import { Labels } from './labels.ts';
import { FIGURE_FIT, FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';
import { PageTerms, SourceRefs } from './sources.ts';
import { ProjectTheme } from './theme.ts';
import type { IResolvedTheme } from './theme.ts';
import { SpecSections } from './sections.ts';
import { ReportSectionsBuilder } from './report-sections.ts';
import type { ISectionContext } from './common/index.ts';

const escaped = (value: string): string => FigureLayout.escapeText({ value });

/** A figure is drawn at most this much larger than its natural width, so a short flow does not turn into a poster. */
const FIGURE_MAX = 1.25;
/** The page becomes one column at and below this viewport width. */
const STACKED_AT = 860;
/**
 * The widest a figure can be drawn: a part with a figure is 1120 px wide, 1088 inside its padding; the explainer's step
 * diagrams (the only figures with an inset beside them) sit in the 960 px text column, 928 inside its padding.
 */
const WIDE_COLUMN = 1088;
const TEXT_COLUMN = 928;

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
 * For each figure: the size it may take (never under FIGURE_FIT of its natural width, never past a quarter more),
 * and the rule that swaps the figure for its list below the viewport width at which it would shrink under FIGURE_FIT
 * of its natural size (text under 12 px). The 66 is the page and frame padding. A key is the width, or the width and
 * the inset: the space a figure shares with something beside it (the numeral of an explainer step) while the page
 * is wide enough for the two columns; at and below 860 px the page is one column and the inset is gone.
 */
const figureFitCss = (opts: { keys: Set<string> }): string =>
  [...opts.keys]
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((key) => {
      const [widthText = '0', insetText = '0', frameText = '0'] = key.split(':');
      const width = Number(widthText);
      const inset = Number(insetText);
      const frame = Number(frameText);
      const name = FigureLayout.fitName({ key });
      const least = Math.ceil(width * FIGURE_FIT);
      const most = Math.ceil(width * FIGURE_MAX);
      const swap = `.fig.${name}{display:none}.fig.${name}~.path,.fig.${name}~.path-detail{display:block}.fig.${name}~.say,.fig.${name}~.legend{display:none}.fig.${name}~.steps .explain{display:block}.fig.${name}~.steps button{pointer-events:none}`;
      const narrow = least + 66 + frame;
      const wide = narrow + inset;
      const rules =
        least > (inset === 0 ? WIDE_COLUMN : TEXT_COLUMN) - inset - frame
          ? [swap]
          : inset === 0
            ? [`@media (max-width:${narrow}px){${swap}}`]
            : [
                `@media (max-width:${Math.min(narrow, STACKED_AT)}px){${swap}}`,
                ...(wide > STACKED_AT
                  ? [`@media (min-width:${STACKED_AT + 1}px) and (max-width:${wide}px){${swap}}`]
                  : []),
              ];

      return `.fig.${name} svg{min-width:${least}px;max-width:${most}px}\n${rules.join('\n')}`;
    })
    .join('\n');

/** The state of the spec as the page says it: a minimap state for the icon, and the word. */
const stateOf = (opts: {
  spec: TVisualizeSpec;
  chrome: TChrome;
}): { state: string; word: string } => {
  const { spec, chrome } = opts;
  const state = BANNER_STATE[spec.status.state] ?? 'info';
  const word =
    spec.status.label ??
    chrome.statusStates[spec.status.state as keyof TChrome['statusStates']] ??
    spec.status.state;

  return { state, word };
};

/** The head of the page: the state, the title, one sentence, the date and the scope. */
const headHtml = (opts: { ctx: ISectionContext; toc: string }): string => {
  const { spec, chrome } = opts.ctx;
  const { state, word } = stateOf({ spec, chrome });
  const meta = [
    spec.asOf === undefined ? '' : `<span>${escaped(chrome.asOf)}: ${escaped(spec.asOf)}</span>`,
    spec.scope === undefined ? '' : `<span>${escaped(chrome.scope)}: ${escaped(spec.scope)}</span>`,
  ].join('');

  return `<header class="head" data-slide><div class="wrap">${SpecSections.chip({ chrome, state, size: 18, label: word })}<h1>${escaped(spec.title)}</h1><p class="lede">${escaped(spec.verdict)}</p>${meta === '' ? '' : `<p class="meta">${meta}</p>`}${opts.toc}</div></header>`;
};

/**
 * What the owner has to do: the numbered actions, or the ask when there are none (never both: the ask would say the
 * same twice), and the plain facts around it. The part has no visible heading; the contents line names it.
 */
const ownerHtml = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { spec, chrome } = opts;
  const { strip } = spec;

  if (strip === undefined && spec.actions === undefined) {
    return '';
  }

  const fact = (label: string, value: string | undefined): string =>
    value === undefined ? '' : `<p class="fact"><b>${escaped(label)}</b> ${escaped(value)}</p>`;

  let list = '';

  if (spec.actions !== undefined) {
    list = `<ol class="check">${spec.actions.map((action) => `<li>${escaped(action)}</li>`).join('')}</ol>`;
  } else if (strip !== undefined) {
    list = `<p class="ask">${escaped(strip.next)}</p>`;
  }

  return `<section class="part own" id="next" data-slide><div class="wrap"><h2 class="vh">${escaped(chrome.next)}</h2>${list}${fact(chrome.blockedBy, strip?.blockedBy)}${fact(chrome.healthy, strip?.healthy)}${fact(chrome.changed, strip?.changed)}</div></section>`;
};

/** The theme of a page that is given none: the default preset. */
const DEFAULT_THEME = ((): IResolvedTheme => {
  const resolved = ProjectTheme.resolve({});

  if (!resolved.ok) {
    throw new Error(
      `the default theme does not pass its own checks: ${resolved.problems.join('; ')}`,
    );
  }

  return resolved.theme;
})();

export class PageShell {
  /** The whole page: one file, no network, a content-security policy that allows only the page's own style and scripts by hash. */
  static render(opts: {
    spec: TVisualizeSpec;
    /** The page's language: the owner's profile, else English. */
    language?: string;
    /** The checked colours of the page; the stylesheet takes its tokens from them. */
    theme?: IResolvedTheme;
  }): string {
    const { spec } = opts;
    const language = opts.language ?? 'en';
    const chrome = Labels.chromeOf({ spec, language });
    const ctx: ISectionContext = {
      spec,
      chrome,
      fits: new Set<string>(),
      spans: new Set<number>(),
    };
    const sources = SourceRefs.entries({ spec, chrome });
    const links = SpecSections.sectionLinks({ spec, chrome })
      .map(
        (link) =>
          `<a href="#${link.id}">${escaped(link.title)}${link.count === undefined ? '' : ` <span>· ${escaped(link.count)}</span>`}</a>`,
      )
      .join('');
    const toc =
      links === ''
        ? ''
        : `<nav class="toc" aria-label="${escaped(chrome.navLabel)}">${links}</nav>`;
    const body = [
      headHtml({ ctx, toc }),
      ownerHtml({ spec, chrome }),
      SpecSections.decisions({ ctx }),
      SpecSections.steps({ ctx }),
      spec.flow === undefined
        ? ''
        : SpecSections.section({
            id: 'flow',
            isWide: true,
            title: chrome.flow,
            body: SpecSections.flow({ ctx }),
          }),
      ReportSectionsBuilder.notes({ ctx }),
      SpecSections.architecture({ ctx }),
      CompareView.section({ ctx }),
      KindsRender.sequenceSection({ ctx }),
      KindsRender.lifecycleSection({ ctx }),
      KindsRender.treeSection({ ctx }),
      SpecSections.comparison({ ctx }),
      SpecSections.ideaMap({ ctx }),
      SpecSections.explainer({ ctx }),
      SpecSections.timeline({ ctx }),
      ReportSectionsBuilder.findings({ ctx }),
      ReportSectionsBuilder.grades({ ctx }),
      ReportSectionsBuilder.metrics({ ctx }),
      SpecSections.beforeAfter({ ctx }),
      SpecSections.decisionRecord({ ctx }),
      ReportSectionsBuilder.evidence({ ctx }),
      ReportSectionsBuilder.risks({ ctx }),
      ReportSectionsBuilder.log({ ctx }),
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
      ReportSectionsBuilder.links({ ctx }),
    ].join('');
    const css = `${Assets.pageCss({ tokens: ProjectTheme.tokensCss({ theme: opts.theme ?? DEFAULT_THEME }) })}\n${NEW_KINDS_CSS}\n${COMPARE_CSS}\n${GridSpans.css({ spans: ctx.spans })}\n${figureFitCss({ keys: ctx.fits })}`;
    const policy = `default-src 'none'; style-src ${sha256({ text: css })}; script-src ${sha256({ text: HEAD_JS })} ${sha256({ text: PAGE_JS })}; base-uri 'none'; form-action 'none'`;
    // A page for the owner (status, plan, decisions) is read, not presented: no Present button and no deck.
    const readOnly =
      spec.minimap !== undefined ||
      spec.strip !== undefined ||
      spec.actions !== undefined ||
      spec.decisions !== undefined;
    const present = readOnly
      ? ''
      : `<button class="btn js-only" id="present" type="button" data-on="${escaped(chrome.present)}" data-off="${escaped(chrome.exitPresent)}">${escaped(chrome.present)}</button>`;
    const bar = `<header class="top"><div class="wrap">${present}<button class="theme" id="theme" type="button" aria-label="${escaped(chrome.themeToDark)}" data-to-light="${escaped(chrome.themeToLight)}" data-to-dark="${escaped(chrome.themeToDark)}">${IconSet.iconSvg({ name: 'sun', size: 20, className: 'sun' })}${IconSet.iconSvg({ name: 'moon', size: 20, className: 'moon' })}<span class="tip" aria-hidden="true"></span></button></div></header>`;
    const deck = readOnly
      ? ''
      : `<nav class="deck" aria-label="${escaped(chrome.slide)}"><button class="btn" id="slide-prev" type="button">${escaped(chrome.previous)}</button><span id="slide-count" aria-live="polite"></span><button class="btn" id="slide-next" type="button">${escaped(chrome.following)}</button></nav>`;

    return `<!doctype html><html lang="${escaped(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${escaped(policy)}"><meta name="generator" content="vulcan page new"><title>${escaped(spec.title)}</title><script>${HEAD_JS}</script><style>${css}</style></head><body>${bar}<main>${body}</main><footer class="foot"><div class="wrap"><p>${escaped(chrome.footer)}</p></div></footer>${deck}<script>${PAGE_JS}</script></body></html>`;
  }
}
