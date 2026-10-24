import { escapeHtml } from './html.ts';

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
const HEADING = /^#{1,6}\s/;
const BLOCKQUOTE = /^>\s?/;
const LIST_ITEM = /^[-*]\s/;
const FENCE = '```';

const LIST_CONTINUATION = /^\s+\S/;

/** Concept links (`[label](/section/id.md)`) become in-page links; any other link stays text. */
const renderInline = (opts: { text: string }): string =>
  escapeHtml({ text: opts.text })
    .replace(
      /\[([^\]]+)\]\((\/[^)]+)\.md\)/g,
      // The text is HTML-escaped already; only `"` is left to escape, or the target leaves the attribute.
      (_match, label: string, target: string) =>
        `<a data-go="${target.replace(/"/g, '&quot;')}">${label}</a>`,
    )
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(\S[^*]*?)\*/g, '<em>$1</em>');

const isTableRow = (opts: { line: string }): boolean => TABLE_ROW.test(opts.line);

const isTableSeparator = (opts: { line: string }): boolean =>
  opts.line.includes('-') && TABLE_SEPARATOR.test(opts.line);

const splitCells = (opts: { line: string }): string[] =>
  opts.line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const renderRow = (opts: { line: string; cellTag: 'th' | 'td' }): string =>
  `<tr>${splitCells({ line: opts.line })
    .map((cell) => `<${opts.cellTag}>${renderInline({ text: cell })}</${opts.cellTag}>`)
    .join('')}</tr>`;

/**
 * The subset concepts use: headings, paragraphs, lists, blockquotes, fenced code, tables.
 * Hard-wrapped source lines join into one paragraph or list item, as in CommonMark.
 */
export const renderMarkdown = (opts: { source: string }): string => {
  const lines = opts.source.split('\n');
  let html = '';
  let inCode = false;
  let inList = false;
  let paragraph: string[] = [];
  let listItem: string[] | undefined;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html += `<p>${renderInline({ text: paragraph.join(' ') })}</p>`;
      paragraph = [];
    }
  };

  const flushListItem = (): void => {
    if (listItem !== undefined) {
      html += `<li>${renderInline({ text: listItem.join(' ') })}</li>`;
      listItem = undefined;
    }
  };

  const closeList = (): void => {
    flushListItem();

    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };

  const flushBlocks = (): void => {
    flushParagraph();
    closeList();
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.startsWith(FENCE)) {
      flushBlocks();
      inCode = !inCode;
      html += inCode ? '<pre><code>' : '</code></pre>';
      continue;
    }

    if (inCode) {
      html += `${escapeHtml({ text: line })}\n`;
      continue;
    }

    const next = lines[index + 1];

    if (isTableRow({ line }) && next !== undefined && isTableSeparator({ line: next })) {
      flushBlocks();
      let table = `<table><thead>${renderRow({ line, cellTag: 'th' })}</thead><tbody>`;

      index += 2;

      while (index < lines.length && isTableRow({ line: lines[index] })) {
        table += renderRow({ line: lines[index], cellTag: 'td' });
        index++;
      }

      index--;
      html += `${table}</tbody></table>`;
      continue;
    }

    if (HEADING.test(line)) {
      flushBlocks();
      html += `<h2>${renderInline({ text: line.replace(/^#+\s/, '') })}</h2>`;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      flushBlocks();
      html += `<blockquote>${renderInline({ text: line.replace(BLOCKQUOTE, '') })}</blockquote>`;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();

      if (!inList) {
        html += '<ul>';
        inList = true;
      }

      flushListItem();
      listItem = [line.replace(LIST_ITEM, '')];
      continue;
    }

    if (listItem !== undefined && LIST_CONTINUATION.test(line)) {
      listItem.push(line.trim());
      continue;
    }

    if (line.trim() === '') {
      flushBlocks();
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  flushBlocks();

  return html;
};
