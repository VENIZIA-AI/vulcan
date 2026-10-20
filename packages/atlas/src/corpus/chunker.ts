import { Corpora } from '@/common';
import type { TCorpus } from '@/common';
import { Authorities, Stopwords } from '@/search/common';
import { BaseHelper } from '@/common/helper';
import type { IChunk, IDocument } from './common';

const TINY_CHUNK_MAX_CHARS = 200;
const OVERSIZED_CHUNK_MAX_CHARS = 6000;

const HEADING_PATTERN = /^(#{2,3})\s+(.+?)\s*$/;
/** Up to three spaces of indent, a run of three or more backticks or tildes, then the rest of the line. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CODE_SPAN_PATTERN = /`([^`\n]+)`/g;
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_.]*/g;
const CAMEL_BOUNDARY_PATTERN = /(?<=[a-z0-9])(?=[A-Z])/;
const CASE_TRANSITION_PATTERN = /[a-z][A-Z]/;
const SCREAMING_PATTERN = /^[A-Z][A-Z0-9]*$/;
const DOTTED_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;

/** One section of a document before anchors, ids and oversized-splitting are applied. */
interface IRawSection {
  level: 0 | 2 | 3;
  title: string;
  headingPath: string;
  body: string;
}

/**
 * Tracks whether the current line sits inside a ``` or ~~~ fence - a heading marker inside one is
 * text. CommonMark's rule, as okf's `unfencedLines` reads it: a fence closes only on a run of the
 * same character, at least as long, with nothing after it.
 */
class FenceTracker {
  private open = '';
  private consumed = 0;
  private openedAt = 0;

  consume(line: string): boolean {
    const fence = FENCE_PATTERN.exec(line);

    this.consumed += 1;

    if (this.open !== '') {
      if (
        fence !== null &&
        fence[1][0] === this.open[0] &&
        fence[1].length >= this.open.length &&
        fence[2].trim() === ''
      ) {
        this.open = '';
      }

      return true;
    }

    // A backtick fence's info string holds no backtick; a line that does is inline code.
    if (fence === null || (fence[1][0] === '`' && fence[2].includes('`'))) {
      return false;
    }

    this.open = fence[1];
    this.openedAt = this.consumed;

    return true;
  }

  /** Whether a fence opened earlier has not yet closed, as of the last `consume()` call - unlike `consume()`'s own return value, this reads `false` again on the very line that closes it. */
  isOpen(): boolean {
    return this.open !== '';
  }

  /** The 1-based line, counted over every line consumed, the fence still open was opened on. */
  openedOn(): number | undefined {
    return this.isOpen() ? this.openedAt : undefined;
  }
}

/** The 1-based body line of a fence the body never closes - a source bug - or `undefined`. */
const unclosedFenceLineOf = (opts: { body: string }): number | undefined => {
  const fence = new FenceTracker();
  const lines = opts.body.split('\n');

  for (const line of lines) {
    fence.consume(line);
  }

  return fence.openedOn();
};

/** GitHub-style anchor slug: lower-case, strip punctuation, spaces become hyphens. */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

/** Walks the body tracking fences and heading levels, merging a section under 200 chars into the one before it. */
const splitIntoSections = (opts: { document: IDocument }): IRawSection[] => {
  const { document } = opts;
  const sections: IRawSection[] = [];
  const fence = new FenceTracker();

  let level: 0 | 2 | 3 = 0;
  let title = document.title;
  let headingPath = document.title;
  let currentH2 = '';
  let buffer: string[] = [];

  const closeCurrent = (): void => {
    const body = buffer.join('\n').trim();

    buffer = [];

    if (level === 0) {
      if (body.length > 0) {
        sections.push({ level, title, headingPath, body });
      }

      return;
    }

    const previous = sections[sections.length - 1];

    if (body.length < TINY_CHUNK_MAX_CHARS && previous) {
      // The heading text itself keeps the words searchable - only the body was folded away before.
      const merged = body.length > 0 ? `${title}\n\n${body}` : title;

      previous.body = `${previous.body}\n\n${merged}`.trim();

      return;
    }

    sections.push({ level, title, headingPath, body });
  };

  const lines = document.body.split('\n');

  for (const line of lines) {
    const inFence = fence.consume(line);
    const heading = inFence ? null : line.match(HEADING_PATTERN);

    if (!heading) {
      buffer.push(line);
      continue;
    }

    closeCurrent();

    level = heading[1].length === 2 ? 2 : 3;
    title = heading[2];

    // Set as soon as the H2 line is read, not when it closes - an H2 that immediately introduces
    // H3s is tiny and merges away, but its children must still resolve it as their parent.
    if (level === 2) {
      currentH2 = title;
    }

    headingPath =
      level === 3 && currentH2
        ? `${document.title} > ${currentH2} > ${title}`
        : `${document.title} > ${title}`;
  }

  closeCurrent();

  return sections;
};

/** GitHub anchors for the final (post-merge) sections, in document order; repeats get `-1`, `-2`. */
const anchorsOf = (opts: { sections: IRawSection[] }): string[] => {
  const seen = new Map<string, number>();

  return opts.sections.map(section => {
    if (section.level === 0) {
      return '';
    }

    const base = slugify(section.title);
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    return count === 0 ? base : `${base}-${count}`;
  });
};

/**
 * Packs paragraphs (blank-line separated) into parts no larger than 6000 chars, never splitting one -
 * and never cutting while a fence opened earlier in the body has not yet closed, even past the
 * limit.
 */
const splitOversized = (opts: { body: string }): string[] => {
  const paragraphs = opts.body.split(/\n{2,}/);
  const fence = new FenceTracker();
  const parts: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (current && !fence.isOpen() && candidate.length > OVERSIZED_CHUNK_MAX_CHARS) {
      parts.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }

    const lines = paragraph.split('\n');

    for (const line of lines) {
      fence.consume(line);
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.length > 0 ? parts : [opts.body];
};

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

/** A whitespace-delimited word that is a URL, not an identifier: `://` anywhere, or a leading `http`. */
const isUrlShaped = (word: string): boolean => word.includes('://') || word.startsWith('http');

const isStopword = (word: string): boolean => Stopwords.isValid(word.toLowerCase());

/** camelCase/PascalCase (an internal lower-to-upper transition), snake_case or SCREAMING_CASE (an underscore or an all-uppercase acronym), or a dotted path - never a stopword or a plain lowercase word. */
export const isIdentifierShaped = (token: string): boolean =>
  !isStopword(token) &&
  (CASE_TRANSITION_PATTERN.test(token) ||
    token.includes('_') ||
    SCREAMING_PATTERN.test(token) ||
    DOTTED_PATH_PATTERN.test(token));

/** Every identifier-shaped `[A-Za-z_][A-Za-z0-9_.]*` token in `text`, split on `.` into its dotted segments; a URL-shaped word or plain prose contributes nothing. */
const identifiersOf = (text: string): string[] => {
  const tokens: string[] = [];
  const words = text.split(/\s+/).filter(word => !isUrlShaped(word));
  const matches = words.join(' ').match(IDENTIFIER_PATTERN) ?? [];

  for (const match of matches) {
    if (!isIdentifierShaped(match)) {
      continue;
    }

    const segments = match.split('.');

    for (const segment of segments) {
      if (segment) {
        tokens.push(segment);
      }
    }
  }

  return tokens;
};

/**
 * Identifier-shaped tokens from a chunk's code spans and fenced code, plus their camelCase-split,
 * lower-cased pieces, de-duplicated. A fence's opening line (delimiter plus info string) is skipped.
 */
const symbolsOf = (opts: { body: string }): string => {
  const fence = new FenceTracker();
  const rawTokens: string[] = [];
  let wasFenced = false;

  const lines = opts.body.split('\n');

  for (const line of lines) {
    const inFence = fence.consume(line);
    const isFenceOpenLine = inFence && !wasFenced;

    wasFenced = inFence;

    if (inFence) {
      if (!isFenceOpenLine) {
        rawTokens.push(...identifiersOf(line));
      }

      continue;
    }

    const spans = line.match(CODE_SPAN_PATTERN) ?? [];

    for (const span of spans) {
      rawTokens.push(...identifiersOf(span.slice(1, -1)));
    }
  }

  const expanded = rawTokens.flatMap(token =>
    token.split(CAMEL_BOUNDARY_PATTERN).map(piece => piece.toLowerCase()),
  );

  return dedupe([...rawTokens, ...expanded]).join(' ');
};

const citationPrefixOf = (corpus: TCorpus): string => {
  switch (corpus) {
    case Corpora.WIKI: {
      return 'wiki';
    }

    case Corpora.CHANGELOG: {
      return 'changelog';
    }

    case Corpora.KNOWLEDGE: {
      return 'okf';
    }

    default: {
      throw new Error(`[citationPrefixOf] unknown corpus | corpus: ${corpus}`);
    }
  }
};

/** Changelogs cite by file stem (`2026-01-01-thing`); wiki and knowledge cite by their full path. */
const citationDocumentOf = (opts: { corpus: TCorpus; path: string }): string =>
  opts.corpus === Corpora.CHANGELOG ? opts.path.replace(/\.md$/, '') : opts.path;

const buildId = (opts: { corpus: TCorpus; path: string; anchor: string }): string =>
  `${citationPrefixOf(opts.corpus)}:${citationDocumentOf(opts)}#${opts.anchor}`;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Frontmatter `description`, `type`, then every `tags` string - a missing key contributes nothing.
 * `title` is excluded: it already leads `headingPath`, so including it would double-count a match.
 */
const metadataOf = (opts: { frontmatter: Record<string, unknown> }): string => {
  const { frontmatter } = opts;
  const parts: string[] = [];

  if (isNonEmptyString(frontmatter.description)) {
    parts.push(frontmatter.description);
  }

  if (isNonEmptyString(frontmatter.type)) {
    parts.push(frontmatter.type);
  }

  if (Array.isArray(frontmatter.tags)) {
    parts.push(...frontmatter.tags.filter(isNonEmptyString));
  }

  return parts.join(' ');
};

/** `okf:log.md` is HISTORY, every other changelog entry is CHANGELOG, everything else is CANONICAL. */
const authorityOf = (opts: { corpus: TCorpus; path: string }): number => {
  const { corpus, path } = opts;

  switch (corpus) {
    case Corpora.CHANGELOG: {
      return Authorities.CHANGELOG;
    }

    case Corpora.KNOWLEDGE: {
      return path === 'log.md' ? Authorities.HISTORY : Authorities.CANONICAL;
    }

    default: {
      return Authorities.CANONICAL;
    }
  }
};

/** Splits a document into H2/H3 sections: never inside a fence, tiny siblings merged, oversized ones paged. */
export class Chunker extends BaseHelper {
  private static instance?: Chunker;

  private constructor() {
    super({ scope: Chunker.name });
  }

  static getInstance(): Chunker {
    return (this.instance ??= new Chunker());
  }

  chunk(opts: { document: IDocument }): IChunk[] {
    const { document } = opts;
    const sections = splitIntoSections({ document });
    const anchors = anchorsOf({ sections });
    const metadata = metadataOf({ frontmatter: document.frontmatter });
    const authority = authorityOf({ corpus: document.corpus, path: document.path });

    const unclosedLine = unclosedFenceLineOf({ body: document.body });

    if (unclosedLine !== undefined) {
      this.logger
        .for('chunk')
        .warn(
          `document ended inside an open fence | corpus: ${document.corpus} | path: ${document.path} | fence opened on line: ${(document.bodyLine ?? 1) + unclosedLine - 1}`,
        );
    }

    const chunks: IChunk[] = [];

    sections.forEach((section, index) => {
      const baseAnchor = anchors[index];
      const parts = splitOversized({ body: section.body });

      if (parts.length > 1) {
        this.logger
          .for('chunk')
          .debug(`split an oversized section | anchor: ${baseAnchor} | parts: ${parts.length}`);
      }

      parts.forEach((body, partIndex) => {
        const anchor = partIndex === 0 ? baseAnchor : `${baseAnchor}-part${partIndex + 1}`;

        chunks.push({
          id: buildId({ corpus: document.corpus, path: document.path, anchor }),
          corpus: document.corpus,
          document: document.path,
          anchor,
          headingPath: section.headingPath,
          title: section.title,
          body,
          symbols: symbolsOf({ body }),
          metadata,
          authority,
        });
      });
    });

    return chunks;
  }
}
