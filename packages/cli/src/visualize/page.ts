import { createHash } from 'node:crypto';
import { PAGE_CSS, PAGE_JS } from './assets.ts';
import { ChangeKinds, DEFAULT_CHROME, MinimapStates } from './constants.ts';
import type { TChangeKind, TChrome } from './constants.ts';
import { columnsOf, escapeText, renderFigure, renderPathList } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

const escaped = (value: string): string => escapeText({ value });

/** A page word by its key; a key the page does not know shows as itself. */
const wordOf = (opts: { words: Record<string, string>; key: string }): string =>
  opts.words[opts.key] ?? opts.key;

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

/** JSON for a `<script type="application/json">`: nothing in it can close the tag or start a comment. */
const jsonForScript = (opts: { value: unknown }): string =>
  JSON.stringify(opts.value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');

const sha256 = (opts: { text: string }): string =>
  `'sha256-${createHash('sha256').update(opts.text).digest('base64')}'`;

/** A table; with `stack` each row becomes a block on a phone and each cell carries its column name. */
const table = (opts: {
  head: string[];
  rows: string[][];
  stack?: boolean;
  className?: string;
}): string =>
  `<div class="tw"><table${opts.stack === true ? ' class="stack"' : opts.className === undefined ? '' : ` class="${opts.className}"`}><thead><tr>${opts.head.map((cell) => `<th>${escaped(cell)}</th>`).join('')}</tr></thead><tbody>${opts.rows
    .map((row) => `<tr>${row.join('')}</tr>`)
    .join('')}</tbody></table></div>`;

const cell = (opts: { value: string; tag?: boolean; label?: string; html?: string }): string =>
  `<td${opts.tag === true ? ' class="tag"' : ''}${opts.label === undefined ? '' : ` data-label="${escaped(opts.label)}"`}>${opts.html ?? escaped(opts.value)}</td>`;

const sectionOf = (opts: { title: string; body: string }): string =>
  `<section><h2>${escaped(opts.title)}</h2>${opts.body}</section>`;

const figureSection = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { flow } = opts.spec;

  if (flow === undefined) {
    return '';
  }

  const { chrome } = opts;
  const kinds = [...new Set(flow.nodes.map((node) => node.kind ?? 'step'))];
  const variants = [...new Set(flow.edges.map((edge) => edge.variant ?? 'main'))];
  const steps = flow.steps;
  const controls = [
    flow.edges.length > 0
      ? `<button id="play" type="button" aria-pressed="false" data-play="${escaped(chrome.play)}" data-pause="${escaped(chrome.pause)}">${escaped(chrome.play)}</button>`
      : '',
    steps.length > 0
      ? `<button id="prev" type="button">${escaped(chrome.previous)}</button><button id="next" type="button">${escaped(chrome.following)}</button><button id="all" type="button">${escaped(chrome.allSteps)}</button>`
      : '',
  ].join('');

  // The figure, then its phone list, then the controls: a sibling order the page CSS relies on to swap the figure for the list.
  return sectionOf({
    title: chrome.flow,
    body: `<div class="fig c${columnsOf({ flow })}">${renderFigure({ flow })}</div>${renderPathList({ flow })}<div class="bar">${controls}</div><p id="detail" aria-live="polite">${escaped(chrome.detailHint)}</p>${
      steps.length > 0 ? `<p id="stepnote" aria-live="polite"></p>` : ''
    }<p class="legend"><span>${escaped(chrome.legend)}:</span>${kinds.map((kind) => `<span>${escaped(kind)}</span>`).join('')}${variants.map((variant) => `<span>${escaped(variant)}</span>`).join('')}</p>${
      steps.length > 0
        ? `<ol class="steps">${steps.map((step) => `<li><b>${escaped(step.title)}</b> - ${escaped(step.note)}</li>`).join('')}</ol><script type="application/json" id="steps">${jsonForScript({ value: steps })}</script>`
        : ''
    }`,
  });
};

const beforeAfterSection = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { beforeAfter } = opts.spec;

  if (beforeAfter === undefined) {
    return '';
  }

  const { chrome } = opts;
  const side = (given: {
    title: string;
    items: { text: string; change?: string }[];
    kind: TChangeKind;
  }): string => {
    const { title, items, kind } = given;

    return `<section><h3 class="lab">${escaped(title)}</h3><ul>${items
      .map((item) =>
        item.change === kind
          ? `<li class="${kind}"><span class="vh">${escaped(kind === ChangeKinds.ADDED ? chrome.added : chrome.removed)}: </span>${escaped(item.text)}</li>`
          : `<li>${escaped(item.text)}</li>`,
      )
      .join('')}</ul></section>`;
  };

  return sectionOf({
    title: `${chrome.before} / ${chrome.after}`,
    body: `<div class="ba">${side({ ...beforeAfter.before, kind: ChangeKinds.REMOVED })}${side({ ...beforeAfter.after, kind: ChangeKinds.ADDED })}</div>`,
  });
};

/** The minimap: one row per task, each with a shape and a word for where it stands. */
const minimapSection = (opts: { spec: TVisualizeSpec; chrome: TChrome }): string => {
  const { minimap } = opts.spec;

  if (minimap === undefined) {
    return '';
  }

  const { chrome } = opts;

  return sectionOf({
    title: chrome.minimap,
    body: table({
      className: 'map',
      head: [chrome.task, chrome.status],
      rows: minimap.map((row) => {
        const key = MinimapStates.keyOf(row.status);
        const word = wordOf({ words: chrome.minimapStates, key });

        return [
          cell({ value: row.task }),
          cell({
            value: word,
            html: `<span class="st ${escaped(key)}"><i></i>${escaped(word)}</span>`,
          }),
        ];
      }),
    }),
  });
};

/** The whole page: one file, no network, a content-security policy that allows only the page's own style and script by hash. */
export const renderPage = (opts: { spec: TVisualizeSpec }): string => {
  const { spec } = opts;
  const chrome = chromeOf({ spec });
  const { state } = spec.status;
  const chip = `<span class="chip ${escaped(state)}"><i></i>${escaped(spec.status.label ?? wordOf({ words: chrome.statusStates, key: state }))}</span>`;
  const meta = [
    spec.asOf === undefined ? '' : `<span>${escaped(chrome.asOf)}: ${escaped(spec.asOf)}</span>`,
    spec.scope === undefined ? '' : `<span>${escaped(chrome.scope)}: ${escaped(spec.scope)}</span>`,
  ].join('');
  const fact = (given: { label: string; value: string }): string =>
    `<div><span class="lab">${escaped(given.label)}</span><p>${escaped(given.value)}</p></div>`;
  const jump =
    spec.decisions === undefined
      ? ''
      : `<a href="#decisions">${escaped(chrome.decisions)} (${spec.decisions.length})</a>`;
  const owner =
    spec.strip === undefined
      ? ''
      : `<section class="owner"><div class="need"><span class="lab">${escaped(chrome.next)}</span><p>${escaped(spec.strip.next)}</p>${jump}</div>${fact({ label: chrome.blockedBy, value: spec.strip.blockedBy })}</section>`;
  const facts =
    spec.strip === undefined
      ? ''
      : `<div class="facts">${fact({ label: chrome.healthy, value: spec.strip.healthy })}${fact({ label: chrome.changed, value: spec.strip.changed })}</div>`;
  const decisions =
    spec.decisions === undefined
      ? ''
      : `<section id="decisions"><h2>${escaped(chrome.decisions)}</h2><ol class="dec">${spec.decisions
          .map(
            (item) =>
              `<li><p class="q">${escaped(item.question)}</p><div class="rec"><span class="lab">${escaped(chrome.recommended)}</span><p>${escaped(item.recommended)}</p></div><p class="chg"><span class="lab">${escaped(chrome.changesClaim)}</span>${escaped(item.changes)}</p></li>`,
          )
          .join('')}</ol></section>`;
  const evidence =
    spec.evidence === undefined
      ? ''
      : sectionOf({
          title: chrome.evidence,
          body: table({
            stack: true,
            head: [chrome.claim, chrome.probe, chrome.result, chrome.label],
            rows: spec.evidence.map((row) => [
              cell({ value: row.claim, label: chrome.claim }),
              cell({ value: row.probe, label: chrome.probe }),
              cell({ value: row.result, label: chrome.result }),
              cell({
                value: row.label,
                html: `<span class="ev ${escaped(row.label)}">${escaped(wordOf({ words: chrome.evidenceLabels, key: row.label }))}</span>`,
                label: chrome.label,
              }),
            ]),
          }),
        });
  const risks =
    spec.risks === undefined
      ? ''
      : sectionOf({
          title: chrome.risks,
          body: table({
            stack: true,
            head: [chrome.risk, chrome.impact, chrome.fallback],
            rows: spec.risks.map((row) => [
              cell({ value: row.risk, label: chrome.risk }),
              cell({ value: row.impact, label: chrome.impact }),
              cell({ value: row.fallback, label: chrome.fallback }),
            ]),
          }),
        });
  const log =
    spec.log === undefined
      ? ''
      : sectionOf({
          title: chrome.log,
          body: table({
            stack: true,
            head: ['', ''],
            rows: spec.log.map((row) => [
              cell({ value: row.date, tag: true }),
              cell({ value: row.text }),
            ]),
          }),
        });
  const links =
    spec.links === undefined
      ? ''
      : sectionOf({
          title: chrome.links,
          body: `<ul class="links">${spec.links.map((link) => `<li><a href="${escaped(link.href)}" rel="noopener noreferrer">${escaped(link.label)}</a></li>`).join('')}</ul>`,
        });
  const policy = `default-src 'none'; style-src ${sha256({ text: PAGE_CSS })}; script-src ${sha256({ text: PAGE_JS })}; base-uri 'none'; form-action 'none'`;

  return `<!doctype html><html lang="${escaped(spec.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escaped(policy)}"><meta name="generator" content="vulcan visualize"><title>${escaped(spec.title)}</title><style>${PAGE_CSS}</style></head><body><main><header><div class="top"><p class="meta">${meta}</p><div class="tools">${chip}<button id="theme" type="button">${escaped(chrome.theme)}</button></div></div><h1>${escaped(spec.title)}</h1></header><p class="verdict">${escaped(spec.verdict)}</p>${spec.caption === undefined ? '' : `<p class="cap">${escaped(spec.caption)}</p>`}${owner}${minimapSection({ spec, chrome })}${facts}${figureSection({ spec, chrome })}${beforeAfterSection({ spec, chrome })}${decisions}${evidence}${risks}${log}${links}<footer>${escaped(chrome.footer)}</footer></main><script>${PAGE_JS}</script></body></html>`;
};
