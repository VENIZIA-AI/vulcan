import type { TVisualizeSpec } from './schema.ts';

/** Escapes text for HTML and for an attribute value: everything the spec says is data, never markup. */
export const escapeText = (opts: { value: string }): string =>
  opts.value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const CELL_WIDTH = 300;
const CELL_HEIGHT = 120;
const BOX_WIDTH = 160;
const BOX_HEIGHT = 64;
const MARGIN = 28;

interface IPoint {
  x: number;
  y: number;
}

const centreOf = (opts: { row: number; col: number }): IPoint => ({
  x: MARGIN + opts.col * CELL_WIDTH + CELL_WIDTH / 2,
  y: MARGIN + opts.row * CELL_HEIGHT + CELL_HEIGHT / 2,
});

const escaped = (value: string): string => escapeText({ value });

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

/** The figure: boxes on a grid, arrows between them. Every part carries a `data-` id the page script highlights. */
export const renderFigure = (opts: { flow: NonNullable<TVisualizeSpec['flow']> }): string => {
  const { flow } = opts;
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const width = MARGIN * 2 + (Math.max(...flow.nodes.map((node) => node.col)) + 1) * CELL_WIDTH;
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

      return `<g class="edge ${escaped(edge.variant ?? 'main')}" data-edge="${escaped(name)}"><title>${escaped(edge.label)}</title><path d="${route.path}" marker-end="url(#${edge.variant === 'error' ? 'e' : 'a'})"/><text x="${route.label.x}" y="${route.label.y}" text-anchor="middle">${escaped(edge.label)}</text></g>`;
    })
    .join('');
  const nodes = flow.nodes
    .map((node) => {
      const centre = centreOf(node);
      const lines = node.sublabel === undefined ? 1 : 2;

      return `<g class="node ${escaped(node.kind ?? 'step')}" tabindex="0" role="img" aria-label="${escaped(node.label)}${node.sublabel === undefined ? '' : `, ${escaped(node.sublabel)}`}" data-node="${escaped(node.id)}" data-detail="${escaped(node.detail ?? node.sublabel ?? node.label)}"><title>${escaped(node.label)}</title><rect x="${centre.x - BOX_WIDTH / 2}" y="${centre.y - BOX_HEIGHT / 2}" width="${BOX_WIDTH}" height="${BOX_HEIGHT}" rx="10"/><text x="${centre.x}" y="${centre.y + (lines === 1 ? 5 : -4)}" text-anchor="middle" class="t">${escaped(node.label)}</text>${node.sublabel === undefined ? '' : `<text x="${centre.x}" y="${centre.y + 16}" text-anchor="middle" class="s">${escaped(node.sublabel)}</text>`}</g>`;
    })
    .join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="flow"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker><marker id="e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="bad" d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}</svg>`;
};
