import { createHash } from 'node:crypto';
import { PAGE_CSS, PAGE_JS } from './assets.ts';
import { ChangeKinds, DEFAULT_CHROME } from './constants.ts';
import type { TChangeKind, TChrome } from './constants.ts';
import { escapeText, renderFigure } from './layout.ts';
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

const table = (opts: { head: string[]; rows: string[][] }): string =>
  `<div class="tw"><table><thead><tr>${opts.head.map((cell) => `<th>${escaped(cell)}</th>`).join('')}</tr></thead><tbody>${opts.rows
    .map((row) => `<tr>${row.join('')}</tr>`)
    .join('')}</tbody></table></div>`;

const cell = (opts: { value: string; tag?: boolean }): string =>
  `<td${opts.tag === true ? ' class="tag"' : ''}>${escaped(opts.value)}</td>`;

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

  return sectionOf({
    title: chrome.flow,
    body: `<div class="bar">${controls}</div><div class="fig">${renderFigure({ flow })}</div><p id="detail" aria-live="polite">${escaped(chrome.detailHint)}</p>${
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

    return `<section><h3>${escaped(title)}</h3><ul>${items
      .map((item) =>
        item.change === kind
          ? `<li class="${kind}">${escaped(item.text)} <small>(${escaped(kind === ChangeKinds.ADDED ? chrome.added : chrome.removed)})</small></li>`
          : `<li>${escaped(item.text)}</li>`,
      )
      .join('')}</ul></section>`;
  };

  return sectionOf({
    title: `${chrome.before} / ${chrome.after}`,
    body: `<div class="ba">${side({ ...beforeAfter.before, kind: ChangeKinds.REMOVED })}${side({ ...beforeAfter.after, kind: ChangeKinds.ADDED })}</div>`,
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
  const strip =
    spec.strip === undefined
      ? ''
      : `<div class="strip"><div><b>${escaped(chrome.healthy)}</b>${escaped(spec.strip.healthy)}</div><div><b>${escaped(chrome.blockedBy)}</b>${escaped(spec.strip.blockedBy)}</div><div><b>${escaped(chrome.changed)}</b>${escaped(spec.strip.changed)}</div><div><b>${escaped(chrome.next)}</b>${escaped(spec.strip.next)}</div></div>`;
  const decisions =
    spec.decisions === undefined
      ? ''
      : sectionOf({
          title: chrome.decisions,
          body: `<ol class="d">${spec.decisions
            .map(
              (item) =>
                `<li>${escaped(item.question)}<br><b>${escaped(chrome.recommended)}:</b> ${escaped(item.recommended)}<br><small>${escaped(chrome.changesClaim)}: ${escaped(item.changes)}</small></li>`,
            )
            .join('')}</ol>`,
        });
  const evidence =
    spec.evidence === undefined
      ? ''
      : sectionOf({
          title: chrome.evidence,
          body: table({
            head: [chrome.claim, chrome.probe, chrome.result, chrome.label],
            rows: spec.evidence.map((row) => [
              cell({ value: row.claim }),
              cell({ value: row.probe }),
              cell({ value: row.result }),
              cell({
                value: wordOf({ words: chrome.evidenceLabels, key: row.label }),
                tag: true,
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
            head: [chrome.risk, chrome.impact, chrome.fallback],
            rows: spec.risks.map((row) => [
              cell({ value: row.risk }),
              cell({ value: row.impact }),
              cell({ value: row.fallback }),
            ]),
          }),
        });
  const log =
    spec.log === undefined
      ? ''
      : sectionOf({
          title: chrome.log,
          body: table({
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
          body: `<ul>${spec.links.map((link) => `<li><a href="${escaped(link.href)}" rel="noopener noreferrer">${escaped(link.label)}</a></li>`).join('')}</ul>`,
        });
  const policy = `default-src 'none'; style-src ${sha256({ text: PAGE_CSS })}; script-src ${sha256({ text: PAGE_JS })}; base-uri 'none'; form-action 'none'`;

  return `<!doctype html><html lang="${escaped(spec.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escaped(policy)}"><meta name="generator" content="vulcan visualize"><title>${escaped(spec.title)}</title><style>${PAGE_CSS}</style></head><body><main><header><div><h1>${escaped(spec.title)}</h1><p class="meta">${meta}</p></div>${chip}<button id="theme" type="button">${escaped(chrome.theme)}</button></header><p class="verdict">${escaped(spec.verdict)}</p>${spec.caption === undefined ? '' : `<p class="cap">${escaped(spec.caption)}</p>`}${figureSection({ spec, chrome })}${strip}${beforeAfterSection({ spec, chrome })}${decisions}${evidence}${risks}${log}${links}</main><script>${PAGE_JS}</script></body></html>`;
};
