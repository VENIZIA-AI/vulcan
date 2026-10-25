import { OwnerDetails, OwnerSections } from './constants.ts';
import type { IOwnerView } from './view.ts';

/** What a reply can get wrong. A structural one can be blocked; a style one is only ever logged. */
export class ShapeClasses {
  static readonly HEADLINE_NOT_SENTENCE = 'headline-not-sentence';
  static readonly HEADLINE_TOO_LONG = 'headline-too-long';
  static readonly MINIMAP_MISSING = 'minimap-missing';
  static readonly MINIMAP_STATUS = 'minimap-status';
  static readonly BLOCKED_MISSING = 'blocked-missing';
  static readonly DECISIONS_MISSING = 'decisions-missing';
  static readonly DECISIONS_MALFORMED = 'decisions-malformed';
  static readonly DECISIONS_NO_RECOMMENDATION = 'decisions-no-recommendation';
  static readonly SECTION_ORDER = 'section-order';
  static readonly EMOJI = 'emoji';
  static readonly SHOUTING = 'shouting';
  static readonly RELATIVE_PATH = 'relative-path';
  static readonly STRUCTURAL = new Set<string>([
    this.HEADLINE_NOT_SENTENCE,
    this.HEADLINE_TOO_LONG,
    this.MINIMAP_MISSING,
    this.MINIMAP_STATUS,
    this.BLOCKED_MISSING,
    this.DECISIONS_MISSING,
    this.DECISIONS_MALFORMED,
    this.DECISIONS_NO_RECOMMENDATION,
    this.SECTION_ORDER,
  ]);
  static readonly SCHEME_SET = new Set<string>([
    ...this.STRUCTURAL,
    this.EMOJI,
    this.SHOUTING,
    this.RELATIVE_PATH,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
  static isStructural(value: string): boolean {
    return this.STRUCTURAL.has(value);
  }
}

export interface IShapeResult {
  /** False for an empty reply or a short one the view exempts. */
  isChecked: boolean;
  classes: string[];
}

const FENCE = /^\s*(?:```|~~~)/;
const NOT_A_SENTENCE = /^(?:#{1,6}\s|\||[-*+]\s|\d+[.)]\s|>)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** Emphasis and quoting marks a label may be wrapped in: `**Blocked:**`, `*Blocked:*`, `__Blocked:__`. */
const MARKS = /[*_`]/g;
/** What may open a line before its text: a quote, a heading, a list marker or a table edge. */
const LINE_OPENER = /^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\|\s*)?/;
const ABBREVIATIONS = /\b(?:etc|e\.g|i\.e|vs|mr|mrs|ms|dr|approx|cf)\./gi;

/** The reply without fenced code, one line per entry: code is data, never structure. An unclosed fence is not one. */
const proseLinesOf = (opts: { text: string }): string[] => {
  const all = opts.text.split(/\r?\n/);

  if (all.filter((line) => FENCE.test(line)).length % 2 === 1) {
    return all;
  }

  const lines: string[] = [];
  let isFenced = false;

  for (const line of all) {
    if (FENCE.test(line)) {
      isFenced = !isFenced;

      continue;
    }

    if (!isFenced) {
      lines.push(line);
    }
  }

  return lines;
};

const plainOf = (opts: { text: string }): string => opts.text.replace(MARKS, '').trim();

/** A line's words as compared: the opener, the emphasis and a closing full stop gone, lower case. */
const normalizedOf = (opts: { line: string }): string =>
  plainOf({ text: opts.line.replace(LINE_OPENER, '') })
    .replace(/\s+/g, ' ')
    .toLowerCase();

const cellsOf = (opts: { line: string }): string[] =>
  opts.line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => plainOf({ text: cell }));

/** Sentences of one paragraph, counting no full stop inside backticks, in a number or an abbreviation. */
const sentenceCountOf = (opts: { paragraph: string }): number => {
  const text = opts.paragraph
    .replace(/`[^`]*`/g, 'x')
    .replace(/\d\.\d/g, '0')
    .replace(ABBREVIATIONS, 'x');

  return text.split(/(?<=[.!?…。！？])\s+(?=\S)/).filter((part) => part.trim() !== '').length;
};

/** The first line at or after `from` whose words start with `label`, or -1. */
const findLabelFrom = (opts: { lines: string[]; label: string; from: number }): number => {
  const label = normalizedOf({ line: opts.label });

  for (let at = opts.from; at < opts.lines.length; at += 1) {
    if (normalizedOf({ line: opts.lines[at] ?? '' }).startsWith(label)) {
      return at;
    }
  }

  return -1;
};

interface IFound {
  /** The line, or -1 when the section is nowhere. */
  at: number;
  problems: string[];
}

const headlineOf = (opts: {
  lines: string[];
  view: IOwnerView;
}): { end: number; problems: string[] } => {
  const start = opts.lines.findIndex((line) => line.trim() !== '');

  if (start === -1) {
    return { end: 0, problems: [] };
  }

  if (NOT_A_SENTENCE.test(opts.lines[start]?.trim() ?? '')) {
    return { end: start + 1, problems: [ShapeClasses.HEADLINE_NOT_SENTENCE] };
  }

  const paragraph: string[] = [];
  let end = start;

  for (const line of opts.lines.slice(start)) {
    if (line.trim() === '') {
      break;
    }

    paragraph.push(line.trim());
    end += 1;
  }

  return {
    end,
    problems:
      sentenceCountOf({ paragraph: paragraph.join(' ') }) > opts.view.headlineMaxSentences
        ? [ShapeClasses.HEADLINE_TOO_LONG]
        : [],
  };
};

const minimapFrom = (opts: { lines: string[]; view: IOwnerView; from: number }): IFound => {
  const { labels } = opts.view;
  const expected = labels.minimapColumns.map((column) => column.toLowerCase());
  const at = opts.lines.findIndex(
    (line, index) =>
      index >= opts.from &&
      TABLE_ROW.test(line) &&
      expected.every(
        (column, position) => (cellsOf({ line })[position] ?? '').toLowerCase() === column,
      ),
  );

  if (at === -1) {
    return { at, problems: [ShapeClasses.MINIMAP_MISSING] };
  }

  const statuses = new Set(Object.values(labels.status).map((status) => status.toLowerCase()));
  const rows: string[][] = [];

  for (const line of opts.lines.slice(at + 2)) {
    if (!TABLE_ROW.test(line)) {
      break;
    }

    rows.push(cellsOf({ line }));
  }

  const isWrong = rows.some(
    (cells) =>
      !statuses.has(
        (cells[2] ?? '')
          .replace(/\s*\(.*\)\s*$/, '')
          .trim()
          .toLowerCase(),
      ),
  );

  return { at, problems: isWrong ? [ShapeClasses.MINIMAP_STATUS] : [] };
};

/** `prefix {x} suffix` as its two ends, emphasis and a closing full stop removed, lower case. */
const recommendationEndsOf = (opts: { template: string }): { prefix: string; suffix: string } => {
  const [before = '', after = ''] = opts.template.split('{x}');
  const clean = (text: string): string => plainOf({ text }).replace(/\.$/, '').toLowerCase();

  return { prefix: clean(before), suffix: clean(after) };
};

const decisionsFrom = (opts: { lines: string[]; view: IOwnerView; from: number }): IFound => {
  const { labels } = opts.view.labels;
  const at = findLabelFrom({ lines: opts.lines, label: labels.decisions, from: opts.from });

  if (at === -1) {
    return { at, problems: [ShapeClasses.DECISIONS_MISSING] };
  }

  const none = normalizedOf({ line: labels.noDecision }).replace(/\.$/, '');
  const same = normalizedOf({ line: opts.lines[at] ?? '' })
    .slice(normalizedOf({ line: labels.decisions }).length)
    .replace(/^[:\s-]+/, '')
    .replace(/\.$/, '');
  const after = opts.lines.slice(at + 1);
  const first = after.find((line) => line.trim() !== '');

  if (
    same === none ||
    (same === '' &&
      first !== undefined &&
      normalizedOf({ line: first }).replace(/\.$/, '') === none)
  ) {
    return { at, problems: [] };
  }

  const items: string[] = [];

  for (const line of after) {
    if (/^\s*\d+[.)]\s/.test(line)) {
      items.push(line.trim());
    } else if (items.length > 0 && /^\s*#{1,6}\s/.test(line)) {
      break;
    } else if (items.length > 0 && line.trim() !== '' && /^\s/.test(line)) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    } else if (items.length > 0 && line.trim() !== '') {
      break;
    }
  }

  if (items.length === 0) {
    return { at, problems: [ShapeClasses.DECISIONS_MALFORMED] };
  }

  const { prefix, suffix } = recommendationEndsOf({ template: labels.recommend });
  const hasRecommendation = (item: string): boolean => {
    const text = plainOf({ text: item }).replace(/\.$/, '').toLowerCase();
    const where = prefix === '' ? 0 : text.lastIndexOf(prefix);

    return (
      where !== -1 &&
      text.length - where - prefix.length - suffix.length > 0 &&
      (suffix === '' || text.endsWith(suffix) || text.slice(where).includes(suffix))
    );
  };

  return {
    at,
    problems: items.every(hasRecommendation) ? [] : [ShapeClasses.DECISIONS_NO_RECOMMENDATION],
  };
};

const styleProblems = (opts: { lines: string[]; view: IOwnerView }): string[] => {
  // The owner's own status words and labels may carry symbols: they are the shape, not a fault.
  const configured = [
    ...Object.values(opts.view.labels.status),
    ...Object.values(opts.view.labels.labels),
  ].sort((first, second) => second.length - first.length);
  const prose = configured.reduce(
    (text, word) => text.replaceAll(word, ' '),
    opts.lines.map((line) => line.replace(/`[^`]*`/g, '')).join('\n'),
  );
  const classes: string[] = [];

  if (/\p{Emoji_Presentation}/u.test(prose)) {
    classes.push(ShapeClasses.EMOJI);
  }

  if (/\b[A-Z]{4,}(?:\s+[A-Z]{4,})+\b/.test(prose)) {
    classes.push(ShapeClasses.SHOUTING);
  }

  if (opts.view.absolutePaths) {
    const spans = opts.lines.flatMap((line) =>
      [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
    );

    if (
      spans.some((span) =>
        /^(?![/~]|[a-z]+:)[\w.-]+(?:\/[\w.@-]+)+\.[a-z0-9]{1,6}$/i.test(span ?? ''),
      )
    ) {
      classes.push(ShapeClasses.RELATIVE_PATH);
    }
  }

  return classes;
};

/**
 * Checks one reply to the owner against the resolved shape: a headline that is a sentence within the
 * cap, the minimap table with the configured header and only the configured statuses, the Blocked line,
 * the decisions list with the recommendation in each item or exactly the none string, and the order. Each
 * section is looked for after the one before it, so a headline that begins with a label is still a
 * headline. Pure and deterministic; what it cannot see (whether a point has a plain meaning, whether the
 * answer is right) is for an eval or the owner. A reply under `shortReplyWords` is exempt, and a person
 * who asked for headline-only reports is held to the headline and the style only.
 */
export const checkOwnerShape = (opts: { text: string; view: IOwnerView }): IShapeResult => {
  const { text, view } = opts;

  if (text.trim() === '' || text.trim().split(/\s+/).length < view.shortReplyWords) {
    return { isChecked: false, classes: [] };
  }

  const lines = proseLinesOf({ text });
  const classes: string[] = [];
  const isHeadlineOnly = view.reportDetail === OwnerDetails.HEADLINE;
  let cursor = 0;
  let isOutOfOrder = false;

  for (const section of view.shape) {
    if (section === OwnerSections.HEADLINE) {
      const found = headlineOf({ lines, view });

      classes.push(...found.problems);
      cursor = found.end;

      continue;
    }

    if (isHeadlineOnly) {
      continue;
    }

    const run = (from: number): IFound => {
      if (section === OwnerSections.MINIMAP) {
        return minimapFrom({ lines, view, from });
      }

      if (section === OwnerSections.BLOCKED) {
        const at = findLabelFrom({ lines, label: view.labels.labels.blocked, from });

        return { at, problems: at === -1 ? [ShapeClasses.BLOCKED_MISSING] : [] };
      }

      return section === OwnerSections.DECISIONS
        ? decisionsFrom({ lines, view, from })
        : { at: -1, problems: [] };
    };
    const after = run(cursor);

    if (after.at !== -1 || section === OwnerSections.DETAIL) {
      classes.push(...after.problems);
      cursor = after.at === -1 ? cursor : after.at + 1;

      continue;
    }

    // Not after the section before it: present earlier means out of order, nowhere means missing.
    const anywhere = run(0);

    if (anywhere.at === -1) {
      classes.push(...anywhere.problems);
    } else {
      isOutOfOrder = true;
      classes.push(...anywhere.problems);
    }
  }

  if (isOutOfOrder) {
    classes.push(ShapeClasses.SECTION_ORDER);
  }

  classes.push(...styleProblems({ lines, view }));

  return { isChecked: true, classes: [...new Set(classes)] };
};
