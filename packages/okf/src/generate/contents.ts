import { markers } from './regions.ts';

/**
 * An agent may preview a file's first lines only (Anthropic's skill guidance: "include a table of
 * contents" in a file "longer than 100 lines", so a partial read "can see the full scope"). A file
 * past this many lines carries a generated contents list near its top.
 */
export const CONTENTS_MIN_LINES = 100;

/** The managed region okf writes the contents list into; no `okf.regions` entry may take it. */
export const CONTENTS_ID = 'contents';
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
/** A fence line: up to three spaces, a run of three or more backticks or tildes, then the rest. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
/** A link, inline or by reference: its text is what the heading shows. */
const LINK = /\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g;
/** What GitHub strips from a heading for its anchor: punctuation but `-` and `_`, symbols, separators but the space. */
const ANCHOR_STRIPPED =
  /(?![ -])(?!\p{Alphabetic})[\p{No}\p{Pd}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\p{Po}\p{S}\p{C}\p{Z}]/gu;

/**
 * The lines outside code fences, by index. A fence closes only on its own character, at least as long
 * as it opened, with nothing after it - so a ```` block can quote a ``` one (CommonMark).
 */
const unfencedLines = (opts: { lines: string[] }): { index: number; line: string }[] => {
  const unfenced: { index: number; line: string }[] = [];
  let open: string | undefined;

  for (const [index, line] of opts.lines.entries()) {
    const fence = FENCE.exec(line);

    if (open !== undefined) {
      if (
        fence !== null &&
        fence[1][0] === open[0] &&
        fence[1].length >= open.length &&
        fence[2].trim() === ''
      ) {
        open = undefined;
      }

      continue;
    }

    // A backtick fence's info string holds no backtick; a line that does is inline code.
    if (fence !== null && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      open = fence[1];
      continue;
    }

    unfenced.push({ index, line });
  }

  return unfenced;
};

/** The lines a file has, as `wc -l` counts them: a final newline ends the last line, it opens none. */
const lineCountOf = (opts: { text: string }): number => {
  const count = opts.text.split('\n').length;

  return opts.text.endsWith('\n') ? count - 1 : count;
};

/** Emphasis as markdown renders it away: `_word_`, `**word**`, `***word***` - never `snake_case`. */
const EMPHASIS = /(?<![\p{L}\p{N}])([*_]{1,3})(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}])/gu;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** A heading's text as GitHub renders it, which is what its anchor is made from: entities decoded, emphasis gone. */
const renderedOf = (opts: { text: string }): string =>
  opts.text
    .replace(EMPHASIS, '$2')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));

        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }

      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    });

/**
 * A heading's anchor as GitHub writes it (github-slugger): lower case; punctuation and symbols gone,
 * `-` and `_` kept; each space a hyphen; a repeat of an earlier anchor takes `-1`, `-2`. `taken`
 * holds the anchors the page has used so far, every heading level counted.
 */
const anchorOf = (opts: { text: string; taken: Map<string, number> }): string => {
  const { taken } = opts;
  const slug = opts.text.toLowerCase().replace(ANCHOR_STRIPPED, '').replace(/ /g, '-');
  let anchor = slug;

  while (taken.has(anchor)) {
    const count = (taken.get(slug) ?? 0) + 1;

    taken.set(slug, count);
    anchor = `${slug}-${count}`;
  }

  taken.set(anchor, 0);

  return anchor;
};

/** The `##` headings outside code fences and frontmatter, in order: the text each shows, its anchor. */
const headingsOf = (opts: { text: string }): { text: string; anchor: string }[] => {
  const body = opts.text.slice(FRONTMATTER.exec(opts.text)?.[0].length ?? 0);
  const taken = new Map<string, number>();
  const headings: { text: string; anchor: string }[] = [];

  for (const { line } of unfencedLines({ lines: body.split('\n') })) {
    const heading = HEADING.exec(line);

    if (heading === null) {
      continue;
    }

    const text = heading[2].replace(LINK, '$1');
    const anchor = anchorOf({ text: renderedOf({ text }), taken });

    if (heading[1] === '##') {
      headings.push({ text, anchor });
    }
  }

  return headings;
};

/**
 * The text with the contents region and the blank line after it taken out. A marker counts only on a
 * line of its own outside a code fence - a page that quotes the markers (in a fence, in prose) keeps
 * every word of it.
 */
const withoutContents = (opts: { text: string }): string => {
  const { start, end } = markers({ id: CONTENTS_ID });
  const lines = opts.text.split('\n');
  let startLine = -1;
  let endLine = -1;

  for (const { index, line } of unfencedLines({ lines })) {
    if (startLine === -1 && line === start) {
      startLine = index;
    } else if (startLine !== -1 && line === end) {
      endLine = index;
      break;
    }
  }

  if (startLine === -1 || endLine === -1) {
    return opts.text;
  }

  const after = lines.slice(endLine + 1);

  return [...lines.slice(0, startLine), ...(after[0] === '' ? after.slice(1) : after)].join('\n');
};

/** Where the list goes: after the frontmatter and the title, so it is among the first lines read. */
const insertionPointOf = (opts: { text: string }): number => {
  let at = FRONTMATTER.exec(opts.text)?.[0].length ?? 0;
  const rest = opts.text.slice(at);
  const title = /^\n*# [^\n]*\n/.exec(rest);

  if (title !== null) {
    at += title[0].length;
  }

  return at + (/^\n*/.exec(opts.text.slice(at))?.[0].length ?? 0);
};

/**
 * The file as `okf gen` writes it: a contents list of its `##` headings near the top when it runs
 * past `CONTENTS_MIN_LINES`, none when it does not. A fixed point - a second pass changes nothing.
 */
export const withContents = (opts: { text: string }): string => {
  // A CRLF file is read as LF and written back with its own endings.
  if (opts.text.includes('\r\n')) {
    return withContents({ text: opts.text.replace(/\r\n/g, '\n') }).replace(/\n/g, '\r\n');
  }

  const bare = withoutContents({ text: opts.text });
  const headings = headingsOf({ text: bare });

  if (lineCountOf({ text: bare }) <= CONTENTS_MIN_LINES || headings.length === 0) {
    return bare;
  }

  const { start, end } = markers({ id: CONTENTS_ID });
  const list = headings.map(heading => `- [${heading.text}](#${heading.anchor})`).join('\n');
  const block = `${start}\n**Contents**\n\n${list}\n${end}\n\n`;
  const at = insertionPointOf({ text: bare });

  return bare.slice(0, at) + block + bare.slice(at);
};
