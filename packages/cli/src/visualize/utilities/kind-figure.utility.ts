import { KindFigureConstants } from '../constants.ts';
import type { TChrome } from '../constants.ts';
import { FigureLayout } from '../layout.ts';

/** The words, the wrapped text and the SVG pieces the figures of the new kinds are drawn with. */
export class KindFigureUtility {
  static wordOf(opts: { chrome: TChrome; key: keyof typeof KindFigureConstants.WORDS }): string {
    const given: Record<string, unknown> = opts.chrome;
    const value = given[opts.key];

    return typeof value === 'string' ? value : KindFigureConstants.WORDS[opts.key];
  }

  /** Greedy wrap into lines of at most `chars` characters; a word longer than a line is cut. */
  static wrapLines(opts: { text: string; chars: number }): string[] {
    const lines: string[] = [];
    let line = '';

    for (const word of opts.text.split(/\s+/).filter((part) => part !== '')) {
      let rest = [...word];

      while (rest.length > opts.chars) {
        if (line !== '') {
          lines.push(line);
          line = '';
        }

        lines.push(rest.slice(0, opts.chars).join(''));
        rest = rest.slice(opts.chars);
      }

      const piece = rest.join('');
      const next = line === '' ? piece : `${line} ${piece}`;

      if (next.length > opts.chars && line !== '') {
        lines.push(line);
        line = piece;
      } else {
        line = next;
      }
    }

    if (line !== '') {
      lines.push(line);
    }

    return lines;
  }

  /** One `<text>` of several lines; a line ends with a space so the text reads whole without the layout. */
  static textLines(opts: {
    cls: string;
    x: number;
    y: number;
    lines: string[];
    step: number;
    anchor?: string;
  }): string {
    return `<text class="${opts.cls}" x="${opts.x}" y="${opts.y}"${opts.anchor === undefined ? '' : ` text-anchor="${opts.anchor}"`}>${opts.lines
      .map(
        (line, index) =>
          `<tspan x="${opts.x}" dy="${index === 0 ? 0 : opts.step}">${FigureLayout.escapeText({ value: line })}${index < opts.lines.length - 1 ? ' ' : ''}</tspan>`,
      )
      .join('')}</text>`;
  }

  /** An arrowhead at a tip, pointing along (dx, dy): filled, or two open strokes. */
  static head(opts: { x: number; y: number; dx: number; dy: number; open?: boolean }): string {
    const { x, y, dx, dy } = opts;
    const bx = x - dx * 10;
    const by = y - dy * 10;
    const px = -dy * 5;
    const py = dx * 5;

    return opts.open === true
      ? `<path class="kopen" d="M${bx + px} ${by + py}L${x} ${y}L${bx - px} ${by - py}"/>`
      : `<path class="khead" d="M${x} ${y}L${bx + px} ${by + py}L${bx - px} ${by - py}Z"/>`;
  }

  static svgOf(opts: { width: number; height: number; label: string; body: string }): string {
    return `<svg class="kf" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}" role="group" aria-label="${FigureLayout.escapeText({ value: opts.label })}">${opts.body}</svg>`;
  }
}
