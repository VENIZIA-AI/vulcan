import { NodeStates } from './constants.ts';
import { IconSet } from './icons.ts';
import type { TVisualizeSpec } from './schema.ts';

const CELL_WIDTH = 290;

const CELL_HEIGHT = 112;

const BOX_WIDTH = 176;

const BOX_HEIGHT = 60;

const MARGIN = 24;

const centreOf = (opts: { row: number; col: number }): IPoint => ({
  x: MARGIN + opts.col * CELL_WIDTH + CELL_WIDTH / 2,
  y: MARGIN + opts.row * CELL_HEIGHT + CELL_HEIGHT / 2,
});

/**
 * The route of an edge between two box centres: straight when they share a row or a column, else an
 * elbow - along the source's row, then along the target's column. The label sits on the longest run.
 */
const routeOf = (opts: { from: IPoint; to: IPoint }): { path: string; label: IPoint } => {
  const { from, to } = opts;

  if (from.y === to.y) {
    const sign = to.x > from.x ? 1 : -1;
    const start = { x: from.x + (sign * BOX_WIDTH) / 2, y: from.y };
    const end = { x: to.x - (sign * BOX_WIDTH) / 2, y: to.y };

    return {
      path: `M${start.x} ${start.y}L${end.x} ${end.y}`,
      label: { x: (start.x + end.x) / 2, y: start.y - 6 },
    };
  }

  if (from.x === to.x) {
    const sign = to.y > from.y ? 1 : -1;
    const start = { x: from.x, y: from.y + (sign * BOX_HEIGHT) / 2 };
    const end = { x: to.x, y: to.y - (sign * BOX_HEIGHT) / 2 };

    return {
      path: `M${start.x} ${start.y}L${end.x} ${end.y}`,
      label: { x: start.x + 6, y: (start.y + end.y) / 2 },
    };
  }

  const horizontal = to.x > from.x ? 1 : -1;
  const vertical = to.y > from.y ? 1 : -1;
  const start = { x: from.x + (horizontal * BOX_WIDTH) / 2, y: from.y };
  const corner = { x: to.x, y: from.y };
  const end = { x: to.x, y: to.y - (vertical * BOX_HEIGHT) / 2 };
  const horizontalRun = Math.abs(corner.x - start.x);
  const verticalRun = Math.abs(end.y - corner.y);

  return {
    path: `M${start.x} ${start.y}L${corner.x} ${corner.y}L${end.x} ${end.y}`,
    label:
      horizontalRun >= verticalRun
        ? { x: (start.x + corner.x) / 2, y: start.y - 6 }
        : { x: corner.x + 6, y: (corner.y + end.y) / 2 },
  };
};

export class FigureLayout {
  private static escaped(value: string): string {
    return FigureLayout.escapeText({ value });
  }

  /** Escapes text for HTML and for an attribute value: everything the spec says is data, never markup. */
  static escapeText(opts: { value: string }): string {
    return opts.value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /** The natural width of a figure of `cols` columns, in pixels. */
  static figureWidth(opts: { cols: number }): number {
    return MARGIN * 2 + opts.cols * CELL_WIDTH;
  }

  /** How many columns a flow spans. */
  static columnsOf(opts: { flow: NonNullable<TVisualizeSpec['flow']> }): number {
    return Math.max(...opts.flow.nodes.map((node) => node.col)) + 1;
  }

  /** The figure: boxes on a grid, arrows between them. Every part carries a `data-` id the page script highlights. */
  static render(opts: { flow: NonNullable<TVisualizeSpec['flow']> }): string {
    const { flow } = opts;
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    const width = FigureLayout.figureWidth({ cols: FigureLayout.columnsOf({ flow }) });
    const height = MARGIN * 2 + (Math.max(...flow.nodes.map((node) => node.row)) + 1) * CELL_HEIGHT;
    const edges = flow.edges
      .map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);

        if (from === undefined || to === undefined) {
          return '';
        }

        const route = routeOf({ from: centreOf(from), to: centreOf(to) });
        const name = `${edge.from}>${edge.to}`;
        // What the owner starts is drawn in the hot colour; a failure keeps its own red.
        const hot = from.state === 'waiting' && edge.variant !== 'error';
        const head = edge.variant === 'error' ? 'e' : hot ? 'h' : 'a';

        return `<g class="edge ${FigureLayout.escaped(edge.variant ?? 'main')}${hot ? ' hot' : ''}" data-edge="${FigureLayout.escaped(name)}"><title>${FigureLayout.escaped(edge.label)}</title><path d="${route.path}" marker-end="url(#${head})"/><text x="${route.label.x}" y="${route.label.y}" text-anchor="middle">${FigureLayout.escaped(edge.label)}</text></g>`;
      })
      .join('');
    const nodes = flow.nodes
      .map((node) => {
        const centre = centreOf(node);
        const lines = node.sublabel === undefined ? 1 : 2;
        const tone = node.state === undefined ? '' : ` c-${NodeStates.toneOf(node.state)}`;
        const gate = node.state === 'waiting';
        const left = centre.x - BOX_WIDTH / 2;
        const anchor = node.state === undefined ? 'middle' : 'start';
        const textX =
          node.state === undefined ? centre.x : left + (node.state === 'waiting' ? 48 : 40);
        const mark =
          node.state === undefined
            ? ''
            : `${gate ? `<circle class="halo" cx="${left + 22}" cy="${centre.y}" r="20"/><circle class="core" cx="${left + 22}" cy="${centre.y}" r="13"/>` : ''}<g class="st" transform="translate(${left + 12} ${centre.y - 10})">${IconSet.iconSvg({ name: NodeStates.iconOf(node.state), size: 20 }).replace('<svg', '<svg x="0" y="0"')}</g>`;

        return `<g class="node ${FigureLayout.escaped(node.kind ?? 'step')}${tone}${gate ? ' gate' : ''}" tabindex="0" role="img" aria-label="${FigureLayout.escaped(node.label)}${node.sublabel === undefined ? '' : `, ${FigureLayout.escaped(node.sublabel)}`}" data-node="${FigureLayout.escaped(node.id)}" data-detail="${FigureLayout.escaped(node.detail ?? node.sublabel ?? node.label)}"><title>${FigureLayout.escaped(node.label)}</title><rect x="${left}" y="${centre.y - BOX_HEIGHT / 2}" width="${BOX_WIDTH}" height="${BOX_HEIGHT}" rx="4"/>${mark}<text x="${textX}" y="${centre.y + (lines === 1 ? 5 : -4)}" text-anchor="${anchor}" class="t">${FigureLayout.escaped(node.label)}</text>${node.sublabel === undefined ? '' : `<text x="${textX}" y="${centre.y + 17}" text-anchor="${anchor}" class="s">${FigureLayout.escaped(node.sublabel)}</text>`}</g>`;
      })
      .join('');

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="flow"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path class="ah" d="M0 0L10 5L0 10z"/></marker><marker id="e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path class="bad" d="M0 0L10 5L0 10z"/></marker><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="15" markerHeight="15" markerUnits="userSpaceOnUse" orient="auto"><path class="hot" d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}</svg>`;
  }

  /**
   * The same flow as a list, for a phone where the figure cannot be read: one row per arrow, then one per box that
   * has a detail. Page CSS shows it only on a narrow screen.
   */
  static renderPathList(opts: { flow: NonNullable<TVisualizeSpec['flow']> }): string {
    const { flow } = opts;
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    const nameOf = (id: string): string => {
      const node = byId.get(id);
      const mark =
        node?.state === undefined
          ? ''
          : `<span class="inl c-${NodeStates.toneOf(node.state)}">${IconSet.iconSvg({ name: NodeStates.iconOf(node.state), size: 16 })}</span>`;

      return `${mark}${FigureLayout.escaped(node?.label ?? id)}`;
    };
    const arrows = flow.edges
      .map(
        (edge) =>
          `<li><b>${nameOf(edge.from)}</b><span class="verb ${FigureLayout.escaped(edge.variant ?? 'main')}">${FigureLayout.escaped(edge.label)}</span><b>${nameOf(edge.to)}</b></li>`,
      )
      .join('');
    const details = flow.nodes
      .filter((node) => node.detail !== undefined)
      .map(
        (node) =>
          `<li><b>${FigureLayout.escaped(node.label)}</b> ${FigureLayout.escaped(node.detail ?? '')}</li>`,
      )
      .join('');

    return `<ol class="path">${arrows}</ol>${details === '' ? '' : `<ul class="path-detail">${details}</ul>`}`;
  }
}

/** Below this share of its natural width the figure is replaced by a list, so no text drops under 12 px. */
export const FIGURE_FIT = 0.92;

interface IPoint {
  x: number;
  y: number;
}
