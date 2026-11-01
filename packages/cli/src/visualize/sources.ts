import { z } from 'zod';
import type { TChrome } from './constants.ts';
import { FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

/** One line of plain text: no markup is interpreted anywhere, it is all escaped. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^(?=.*\S)[^\p{Cc}‪-‮⁦-⁩]+$/u, 'one line of text, not blank');

/** The limits of the sources and the terms. */
export class SourceLimits {
  static readonly COMMIT_LENGTH = 40;
  static readonly MAX_TERMS = 12;
  static readonly MAX_TERM = 40;
  static readonly MAX_MEANING = 200;
}

/**
 * Where a claim comes from: a repository, the commit it was read at, a path in it and, when it helps, the lines. The shape
 * is checked by `SourceRefs.check` (a commit is 40 lowercase hex characters, a path is relative), so the refusal says why.
 */
export const SOURCE_SCHEMA = z.strictObject({
  repo: text(100).describe('the repository, like owner/name'),
  commit: text(64).describe('the full commit: exactly 40 lowercase hex characters'),
  path: text(200).describe('a path inside the repository: relative, without ..'),
  lines: text(16).optional().describe('12 or 12-30, the start not after the end'),
});

/** The words of the page that a reader may not know, each with what it means here. */
export const TERMS_SCHEMA = z
  .array(
    z.strictObject({
      term: text(SourceLimits.MAX_TERM),
      meaning: text(SourceLimits.MAX_MEANING),
    }),
  )
  .min(1)
  .max(SourceLimits.MAX_TERMS);

export type TSource = z.output<typeof SOURCE_SCHEMA>;
export type TTerms = z.output<typeof TERMS_SCHEMA>;

/** A source and every place on the page that points at it. */
export interface ISourceEntry {
  text: string;
  by: string[];
}

/** What holds a source: a box of the flow, a step of the flow, a box of the compare view. */
type TSourceHolder = 'flow' | 'step' | 'compare';

interface ISourceUse {
  place: string;
  holder: TSourceHolder;
  label: string;
  source: TSource;
}

const escaped = (value: string): string => FigureLayout.escapeText({ value });

const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const LINES = /^([1-9]\d{0,6})(?:-([1-9]\d{0,6}))?$/;

/** Sources: how one is written, checked and listed. */
export class SourceRefs {
  /** `repo@commit:path:lines`, the commit in full. */
  static textOf(opts: { source: TSource }): string {
    const { repo, commit, path, lines } = opts.source;

    return `${repo}@${commit}:${path}${lines === undefined ? '' : `:${lines}`}`;
  }

  /** A line of text with the source after it. */
  static withSource(opts: { text: string | undefined; source: TSource }): string {
    const source = SourceRefs.textOf({ source: opts.source });

    return opts.text === undefined ? source : `${opts.text} ${source}`;
  }

  /** The source as markup: its text in a code element, escaped like every other text. */
  static html(opts: { source: TSource }): string {
    return `<code class="src">${escaped(SourceRefs.textOf({ source: opts.source }))}</code>`;
  }

  /** What is wrong with one source, in words, or nothing. */
  static problemsOf(opts: { place: string; source: TSource }): string[] {
    const { place, source } = opts;
    const problems: string[] = [];

    if (!REPO.test(source.repo)) {
      problems.push(
        `${place}: repo '${source.repo}' is not owner/name (letters, digits, . _ - and /)`,
      );
    }

    if (!COMMIT.test(source.commit)) {
      problems.push(
        `${place}: commit '${source.commit}' is not exactly ${SourceLimits.COMMIT_LENGTH} lowercase hex characters - give the full commit, not a short one or a branch`,
      );
    }

    if (/^([\\/]|[A-Za-z]:)/.test(source.path)) {
      problems.push(
        `${place}: path '${source.path}' is absolute - give it from the repository root`,
      );
    }

    if (source.path.includes('..')) {
      problems.push(`${place}: path '${source.path}' contains '..'`);
    }

    // A path is a path in the repository, not an address, a home folder or an escaped path.
    if (/^~|:\/\/|%|[․‥…．]/.test(source.path)) {
      problems.push(
        `${place}: path '${source.path}' is not a plain path inside the repository (no address, no ~, no % escapes)`,
      );
    }

    if (source.lines !== undefined) {
      const found = LINES.exec(source.lines);

      if (found === null) {
        problems.push(`${place}: lines '${source.lines}' is not 12 or 12-30`);
      } else if (Number(found[1]) > Number(found[2] ?? found[1])) {
        problems.push(`${place}: lines '${source.lines}' starts after it ends`);
      }
    }

    return problems;
  }

  /** Every source of the page with the place that holds it, in the order the page shows them. */
  private static uses(opts: { spec: TVisualizeSpec }): ISourceUse[] {
    const { flow, compare } = opts.spec;
    const found: ISourceUse[] = [];

    for (const [index, node] of (flow?.nodes ?? []).entries()) {
      if (node.source !== undefined) {
        found.push({
          place: `flow.nodes[${index}].source`,
          holder: 'flow',
          label: node.label,
          source: node.source,
        });
      }
    }

    for (const [index, step] of (flow?.steps ?? []).entries()) {
      if (step.source !== undefined) {
        found.push({
          place: `flow.steps[${index}].source`,
          holder: 'step',
          label: step.title,
          source: step.source,
        });
      }
    }

    for (const [index, node] of (compare?.nodes ?? []).entries()) {
      if (node.source !== undefined) {
        found.push({
          place: `compare.nodes[${index}].source`,
          holder: 'compare',
          label: node.label,
          source: node.source,
        });
      }
    }

    return found;
  }

  /** What a schema cannot say about the sources and the terms. */
  static check(opts: { spec: TVisualizeSpec }): string[] {
    const problems = SourceRefs.uses(opts).flatMap((use) =>
      SourceRefs.problemsOf({ place: use.place, source: use.source }),
    );
    const seen = new Set<string>();

    for (const item of opts.spec.terms ?? []) {
      const key = item.term.toLowerCase();

      if (seen.has(key)) {
        problems.push(`terms: '${item.term}' is listed twice`);
      }

      seen.add(key);
    }

    return problems;
  }

  /** Each distinct source once, in order of appearance, with what points at it. */
  static entries(opts: { spec: TVisualizeSpec; chrome: TChrome }): ISourceEntry[] {
    const { chrome } = opts;
    const word: Record<TSourceHolder, string> = {
      flow: chrome.flow,
      step: chrome.step,
      compare: chrome.compareView,
    };
    const byText = new Map<string, ISourceEntry>();

    for (const use of SourceRefs.uses(opts)) {
      const key = SourceRefs.textOf({ source: use.source });
      const entry = byText.get(key) ?? { text: key, by: [] };
      const by = `${word[use.holder]}: ${use.label}`;

      if (!entry.by.includes(by)) {
        entry.by.push(by);
      }

      byText.set(key, entry);
    }

    return [...byText.values()];
  }

  /** The body of the `sources` part: a list, each source once with what points at it. */
  static listHtml(opts: { entries: ISourceEntry[] }): string {
    return `<ol class="srcs">${opts.entries
      .map(
        (entry) =>
          `<li><code class="src">${escaped(entry.text)}</code><span class="by">${entry.by.map(escaped).join(', ')}</span></li>`,
      )
      .join('')}</ol>`;
  }
}

/** The terms of the page: shown as a definition list, and each one must show up in the page's other text. */
export class PageTerms {
  /** The body of the `terms` part: a definition list. */
  static listHtml(opts: { terms: TTerms }): string {
    return `<dl class="terms">${opts.terms
      .map((item) => `<div><dt>${escaped(item.term)}</dt><dd>${escaped(item.meaning)}</dd></div>`)
      .join('')}</dl>`;
  }

  /** The text of a page: what is in the body, without scripts, styles, markup, and without the terms part itself. */
  static textOf(opts: { html: string }): string {
    const body = opts.html.slice(opts.html.indexOf('<body>'));

    return body
      .replace(/<section class="part" id="terms"[\s\S]*?<\/section>/, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&')
      .toLowerCase();
  }

  /** A warning for each term the rest of the page never uses: a word nobody meets needs no definition. */
  static warnings(opts: { html: string; terms: TTerms | undefined }): string[] {
    if (opts.terms === undefined) {
      return [];
    }

    const page = PageTerms.textOf({ html: opts.html });

    return opts.terms
      .filter((item) => !page.includes(item.term.toLowerCase()))
      .map((item) => `terms: '${item.term}' never appears in the page text`);
  }
}
