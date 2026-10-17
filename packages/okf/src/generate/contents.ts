import { markers } from './regions.ts';

/**
 * An agent may preview a file's first lines only (Anthropic's skill guidance: "include a table of
 * contents" in a file "longer than 100 lines", so a partial read "can see the full scope"). A file
 * past this many lines carries a generated contents list near its top.
 */
export const CONTENTS_MIN_LINES = 100;

const CONTENTS_ID = 'contents';
const FENCE = /^(```|~~~)/;
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;

/** The `##` headings outside code fences, in order. */
const headingsOf = (opts: { text: string }): string[] => {
  const headings: string[] = [];
  let fenced = false;

  for (const line of opts.text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }

    if (!fenced && line.startsWith('## ')) {
      headings.push(line.slice(3).trim());
    }
  }

  return headings;
};

/** A heading's anchor as GitHub and VitePress write it: lower case, punctuation gone, spaces as hyphens. */
const anchorOf = (opts: { heading: string }): string =>
  opts.heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/**
 * The text with the contents region and the blank line after it taken out. A marker counts only on a
 * line of its own outside a code fence - a page that quotes the markers (in a fence, in prose) keeps
 * every word of it.
 */
const withoutContents = (opts: { text: string }): string => {
  const { start, end } = markers({ id: CONTENTS_ID });
  const lines = opts.text.split('\n');
  let fenced = false;
  let startLine = -1;
  let endLine = -1;

  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }

    if (fenced) {
      continue;
    }

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

  if (bare.split('\n').length <= CONTENTS_MIN_LINES || headings.length === 0) {
    return bare;
  }

  const { start, end } = markers({ id: CONTENTS_ID });
  const list = headings.map(heading => `- [${heading}](#${anchorOf({ heading })})`).join('\n');
  const block = `${start}\n**Contents**\n\n${list}\n${end}\n\n`;
  const at = insertionPointOf({ text: bare });

  return bare.slice(0, at) + block + bare.slice(at);
};
