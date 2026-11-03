/**
 * Cards in a row share their rows: each card spans as many rows of its grid as it has parts, and takes those rows over
 * from the grid (`grid-template-rows: subgrid`), so the score, the title, each criterion and each pro of one card sit
 * at the same height as the same part of its neighbours, whatever wraps. The number of rows is only known when the page
 * is made, and an inline `style` is blocked by the page's policy, so a class names the span (`sp4`) and the page carries
 * the rules for exactly the spans it uses.
 */
export class GridSpans {
  /** The most rows a card can span: a tag, a total, a title, a line, 8 criteria, 6 pros and 6 cons, and room to spare. */
  static readonly MAX = 40;

  /** The class that makes an element span `count` rows; remembers the span so the page carries its rule. */
  static classOf(opts: { count: number; spans: Set<number> }): string {
    const count = Math.max(1, Math.min(GridSpans.MAX, Math.round(opts.count)));

    opts.spans.add(count);

    return `sp${count}`;
  }

  /** The rules of the spans a page uses; with no subgrid in the browser, or in one column (a phone), a card is a plain block. */
  static css(opts: { spans: Set<number> }): string {
    if (opts.spans.size === 0) {
      return '';
    }

    const rules = [...opts.spans]
      .sort((a, b) => a - b)
      .map((count) => `.sp${count}{grid-row-end:span ${count}}`)
      .join('');

    return `@media (min-width:621px){@supports (grid-template-rows:subgrid){${rules}}}`;
  }
}
