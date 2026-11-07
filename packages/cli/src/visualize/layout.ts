import { NodeStates } from './constants.ts';
import { IconSet } from './icons.ts';
import type { TVisualizeSpec } from './schema.ts';

type TFlow = NonNullable<TVisualizeSpec['flow']>;
type TNode = TFlow['nodes'][number];
type TEdge = TFlow['edges'][number];

const MARGIN = 24;
const MIN_BOX_WIDTH = 176;
const MAX_BOX_WIDTH = 264;
const MIN_BOX_HEIGHT = 60;
const SIDE_PADDING = 24;
const TOP_PADDING = 26;
const MIN_COLUMN_GAP = 114;
const MIN_ROW_GAP = 52;
const TITLE_SIZE = 15;
const SUBTITLE_SIZE = 13;
const EDGE_SIZE = 13;
const TITLE_LINE = 19;
const SUBTITLE_LINE = 16;
const EDGE_LINE = 16;
const MAX_EDGE_LABEL_WIDTH = 96;
/** A box does not widen for its second line: a sublabel longer than this wraps. */
const SUBTITLE_WRAP = 168;
const LABEL_CLEARANCE = 10;

/**
 * The width of a text in pixels, by a per-character estimate that errs wide: the page draws the figure before any
 * script runs, so the boxes and the gaps are sized from the text, never from a measurement.
 */
const widthOf = (opts: { text: string; size: number; isBold?: boolean }): number =>
  [...opts.text].reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0;
    const bold = opts.isBold === true;
    // Wide scripts (CJK, Hangul, fullwidth forms) are about one em; a combining mark adds nothing; every Latin
    // letter, Vietnamese with its marks included, is one narrow unit.
    const unit =
      code >= 0x2e80
        ? 1.05
        : code >= 0x300 && code <= 0x36f
          ? 0
          : /[A-Z]/.test(char)
            ? bold
              ? 0.7
              : 0.66
            : bold
              ? 0.58
              : 0.56;

    return sum + unit * opts.size;
  }, 0);

/** The lines a text breaks into at `max` pixels: at spaces, and inside a word only when the word alone is wider. */
const breakLines = (opts: {
  text: string;
  size: number;
  isBold?: boolean;
  max: number;
}): string[] => {
  const lines: string[] = [];
  let line = '';

  for (const word of opts.text.split(/\s+/).filter((item) => item !== '')) {
    const next = line === '' ? word : `${line} ${word}`;

    if (widthOf({ ...opts, text: next }) <= opts.max) {
      line = next;
      continue;
    }

    if (line !== '') {
      lines.push(line);
      line = '';
    }

    let rest = word;

    while (widthOf({ ...opts, text: rest }) > opts.max && rest.length > 1) {
      let cut = rest.length - 1;

      while (cut > 1 && widthOf({ ...opts, text: rest.slice(0, cut) }) > opts.max) {
        cut -= 1;
      }

      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }

    line = rest;
  }

  return line === '' ? lines : [...lines, line];
};

/** The same lines, balanced: no last line of one short word. The width is narrowed while the line count stays. */
const wrap = (opts: { text: string; size: number; isBold?: boolean; max: number }): string[] => {
  const lines = breakLines(opts);
  let best = lines;

  if (lines.length > 1) {
    for (let max = opts.max - 4; max > 0; max -= 4) {
      const tighter = breakLines({ ...opts, max });

      if (tighter.length !== lines.length) {
        break;
      }

      best = tighter;
    }
  }

  return best;
};

interface IPoint {
  x: number;
  y: number;
}

interface IBox {
  node: TNode;
  width: number;
  height: number;
  titleLines: string[];
  subtitleLines: string[];
  /** Where the text starts inside the box, from its left edge. */
  textLeft: number;
}

interface IPlaced extends IBox {
  centre: IPoint;
}

interface IGeometry {
  width: number;
  height: number;
  boxes: Map<string, IPlaced>;
  columnGaps: number[];
  rowGaps: number[];
  columnLefts: number[];
  columnWidths: number[];
  rowTops: number[];
  rowHeights: number[];
}

interface IRoute {
  path: string;
  /** Where the label goes: `x` is the middle for a horizontal run and the left edge for a vertical one. */
  label: IPoint;
  isVertical: boolean;
  lines: string[];
}

const boxOf = (opts: { node: TNode }): IBox => {
  const { node } = opts;
  const isActor = node.kind === 'actor';
  const textLeft =
    node.state === undefined ? (isActor ? 22 : 14) : node.state === 'waiting' ? 48 : 40;
  const textRight = isActor ? 22 : 14;
  const wanted =
    Math.max(
      widthOf({ text: node.label, size: TITLE_SIZE, isBold: true }),
      node.sublabel === undefined
        ? 0
        : Math.min(widthOf({ text: node.sublabel, size: SUBTITLE_SIZE }), SUBTITLE_WRAP),
    ) +
    textLeft +
    textRight;
  const width = Math.min(Math.max(Math.ceil(wanted), MIN_BOX_WIDTH), MAX_BOX_WIDTH);
  const inner = width - textLeft - textRight;
  const titleLines = wrap({ text: node.label, size: TITLE_SIZE, isBold: true, max: inner });
  const subtitleLines =
    node.sublabel === undefined
      ? []
      : wrap({ text: node.sublabel, size: SUBTITLE_SIZE, max: inner });
  const text =
    titleLines.length * TITLE_LINE +
    (subtitleLines.length === 0 ? 0 : 4 + subtitleLines.length * SUBTITLE_LINE);

  return {
    node,
    width,
    height: Math.max(MIN_BOX_HEIGHT, 20 + text),
    titleLines,
    subtitleLines,
    textLeft,
  };
};

const edgeLinesOf = (opts: { edge: TEdge }): string[] =>
  wrap({ text: opts.edge.label, size: EDGE_SIZE, max: MAX_EDGE_LABEL_WIDTH });

const edgeWidthOf = (opts: { lines: string[] }): number =>
  Math.max(...opts.lines.map((line) => widthOf({ text: line, size: EDGE_SIZE })));

/**
 * The boxes of a figure on its grid, sized from their text: a column is as wide as its widest box, a row as tall as
 * its tallest, and the gap after a column is as wide as the widest arrow label that sits in it, so a label has the
 * free part of its arrow to itself.
 */
const geometryOf = (opts: { nodes: TNode[]; edges: TEdge[] }): IGeometry => {
  const boxes = opts.nodes.map((node) => boxOf({ node }));
  const columns = Math.max(...opts.nodes.map((node) => node.col)) + 1;
  const rows = Math.max(...opts.nodes.map((node) => node.row)) + 1;
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      MIN_BOX_WIDTH,
      ...boxes.filter((box) => box.node.col === column).map((box) => box.width),
    ),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(
      MIN_BOX_HEIGHT,
      ...boxes.filter((box) => box.node.row === row).map((box) => box.height),
    ),
  );
  const byId = new Map(opts.nodes.map((node) => [node.id, node]));
  const columnGaps = Array.from({ length: columns }, () => MIN_COLUMN_GAP);

  for (const edge of opts.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (from === undefined || to === undefined || from.col === to.col) {
      continue;
    }

    const gap = to.col > from.col ? from.col : from.col - 1;
    const need = Math.ceil(edgeWidthOf({ lines: edgeLinesOf({ edge }) })) + 2 * LABEL_CLEARANCE;

    columnGaps[gap] = Math.max(columnGaps[gap] ?? MIN_COLUMN_GAP, need);
  }

  const rowGaps = Array.from({ length: rows }, () => MIN_ROW_GAP);
  const columnLefts: number[] = [];
  const rowTops: number[] = [];
  let x = MARGIN + SIDE_PADDING;
  let y = MARGIN + TOP_PADDING;

  for (const [column, width] of columnWidths.entries()) {
    columnLefts.push(x);
    x += width + (columnGaps[column] ?? 0);
  }

  for (const [row, height] of rowHeights.entries()) {
    rowTops.push(y);
    y += height + (rowGaps[row] ?? 0);
  }

  const boxesById = new Map<string, IPlaced>();

  for (const box of boxes) {
    boxesById.set(box.node.id, {
      ...box,
      centre: {
        x: (columnLefts[box.node.col] ?? 0) + (columnWidths[box.node.col] ?? 0) / 2,
        y: (rowTops[box.node.row] ?? 0) + (rowHeights[box.node.row] ?? 0) / 2,
      },
    });
  }

  return {
    width: Math.ceil(x - (columnGaps[columns - 1] ?? 0) + MARGIN + SIDE_PADDING),
    height: Math.ceil(y - (rowGaps[rows - 1] ?? 0) + MARGIN + TOP_PADDING),
    boxes: boxesById,
    columnGaps,
    rowGaps,
    columnLefts,
    columnWidths,
    rowTops,
    rowHeights,
  };
};

/**
 * The route of an edge between two boxes: straight when they share a row or a column, else an elbow - along the
 * source's row, then along the target's column. The label sits in the free part of the arrow next to the source: in
 * the gap after the source's column for a horizontal run (centred, above the line), in the gap after its row for a
 * vertical one (beside the line).
 */
const routeOf = (opts: {
  from: IPlaced;
  to: IPlaced;
  edge: TEdge;
  geometry: IGeometry;
}): IRoute => {
  const { from, to, geometry } = opts;
  const lines = edgeLinesOf({ edge: opts.edge });
  const right = to.centre.x > from.centre.x ? 1 : -1;
  const down = to.centre.y > from.centre.y ? 1 : -1;
  const columnGapMiddle = (): number => {
    const column = right === 1 ? from.node.col : from.node.col - 1;

    return (
      (geometry.columnLefts[column] ?? 0) +
      (geometry.columnWidths[column] ?? 0) +
      (geometry.columnGaps[column] ?? 0) / 2
    );
  };
  const rowGapMiddle = (): number => {
    const row = down === 1 ? from.node.row : from.node.row - 1;

    return (
      (geometry.rowTops[row] ?? 0) +
      (geometry.rowHeights[row] ?? 0) +
      (geometry.rowGaps[row] ?? 0) / 2
    );
  };

  if (from.centre.y === to.centre.y) {
    const start = { x: from.centre.x + (right * from.width) / 2, y: from.centre.y };
    const end = { x: to.centre.x - (right * to.width) / 2, y: to.centre.y };

    return {
      path: `M${start.x} ${start.y}L${end.x} ${end.y}`,
      label: { x: columnGapMiddle(), y: start.y - 6 },
      isVertical: false,
      lines,
    };
  }

  if (from.centre.x === to.centre.x) {
    const start = { x: from.centre.x, y: from.centre.y + (down * from.height) / 2 };
    const end = { x: to.centre.x, y: to.centre.y - (down * to.height) / 2 };

    return {
      path: `M${start.x} ${start.y}L${end.x} ${end.y}`,
      label: { x: start.x + 10, y: rowGapMiddle() },
      isVertical: true,
      lines,
    };
  }

  const start = { x: from.centre.x + (right * from.width) / 2, y: from.centre.y };
  const corner = { x: to.centre.x, y: from.centre.y };
  const end = { x: to.centre.x, y: to.centre.y - (down * to.height) / 2 };
  const path = `M${start.x} ${start.y}L${corner.x} ${corner.y}L${end.x} ${end.y}`;

  return Math.abs(corner.x - start.x) >= Math.abs(end.y - corner.y)
    ? { path, label: { x: columnGapMiddle(), y: start.y - 6 }, isVertical: false, lines }
    : { path, label: { x: corner.x + 10, y: rowGapMiddle() }, isVertical: true, lines };
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

  /** The width of a text in pixels, by the same estimate the figure uses for its boxes and its arrow labels. */
  static textWidth(opts: { text: string; size: number; isBold?: boolean }): number {
    return widthOf(opts);
  }

  /** The natural width of a figure, in pixels: its columns as wide as their boxes need, and the gaps as wide as their arrow labels need. */
  static widthOf(opts: { nodes: TNode[]; edges: TEdge[] }): number {
    return geometryOf(opts).width;
  }

  /** The `<text>` of an arrow label: one line, or the lines it wraps into, stacked above the line or beside it. */
  private static edgeText(opts: { route: IRoute }): string {
    const { route } = opts;
    const [first = ''] = route.lines;
    const anchor = route.isVertical ? 'start' : 'middle';
    const top = route.isVertical
      ? route.label.y - ((route.lines.length - 1) * EDGE_LINE) / 2
      : route.label.y - (route.lines.length - 1) * EDGE_LINE;

    if (route.lines.length === 1) {
      return `<text x="${route.label.x}" y="${top}" text-anchor="${anchor}">${FigureLayout.escaped(first)}</text>`;
    }

    return `<text x="${route.label.x}" y="${top}" text-anchor="${anchor}">${route.lines
      .map(
        (line, index) =>
          `<tspan x="${route.label.x}"${index === 0 ? '' : ` dy="${EDGE_LINE}"`}>${FigureLayout.escaped(line)}</tspan>`,
      )
      .join('')}</text>`;
  }

  /** The figure: boxes on a grid, arrows between them. Every part carries a `data-` id the page script highlights. */
  static render(opts: { flow: TFlow }): string {
    const { flow } = opts;
    const geometry = geometryOf({ nodes: flow.nodes, edges: flow.edges });
    const { width, height } = geometry;
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    const edges = flow.edges
      .map((edge) => {
        const from = geometry.boxes.get(edge.from);
        const to = geometry.boxes.get(edge.to);
        const source = byId.get(edge.from);

        if (from === undefined || to === undefined || source === undefined) {
          return '';
        }

        const route = routeOf({ from, to, edge, geometry });
        const name = `${edge.from}>${edge.to}`;
        // What the owner starts is drawn in the hot colour; a failure keeps its own red.
        const hot = source.state === 'waiting' && edge.variant !== 'error';
        const head = edge.variant === 'error' ? 'e' : hot ? 'h' : 'a';

        return `<g class="edge ${FigureLayout.escaped(edge.variant ?? 'main')}${hot ? ' hot' : ''}" data-edge="${FigureLayout.escaped(name)}"><title>${FigureLayout.escaped(edge.label)}</title><path d="${route.path}" marker-end="url(#${head})"/>${FigureLayout.edgeText({ route })}</g>`;
      })
      .join('');
    const nodes = [...geometry.boxes.values()]
      .map((box) => {
        const { node, centre } = box;
        const tone = node.state === undefined ? '' : ` c-${NodeStates.toneOf(node.state)}`;
        const gate = node.state === 'waiting';
        const left = centre.x - box.width / 2;
        const top = centre.y - box.height / 2;
        const anchor = node.state === undefined ? 'middle' : 'start';
        const textX = node.state === undefined ? centre.x : left + box.textLeft;
        const textHeight =
          box.titleLines.length * TITLE_LINE +
          (box.subtitleLines.length === 0 ? 0 : 4 + box.subtitleLines.length * SUBTITLE_LINE);
        const first = centre.y - textHeight / 2;
        const mark =
          node.state === undefined
            ? ''
            : `${gate ? `<circle class="halo" cx="${left + 22}" cy="${centre.y}" r="20"/><circle class="core" cx="${left + 22}" cy="${centre.y}" r="13"/>` : ''}<g class="st" transform="translate(${left + 12} ${centre.y - 10})">${IconSet.iconSvg({ name: NodeStates.iconOf(node.state), size: 20 }).replace('<svg', '<svg x="0" y="0"')}</g>`;
        const titles = box.titleLines
          .map(
            (line, index) =>
              `<text x="${textX}" y="${first + 14 + index * TITLE_LINE}" text-anchor="${anchor}" class="t">${FigureLayout.escaped(line)}</text>`,
          )
          .join('');
        const subtitles = box.subtitleLines
          .map(
            (line, index) =>
              `<text x="${textX}" y="${first + box.titleLines.length * TITLE_LINE + 16 + index * SUBTITLE_LINE}" text-anchor="${anchor}" class="s">${FigureLayout.escaped(line)}</text>`,
          )
          .join('');

        return `<g class="node ${FigureLayout.escaped(node.kind ?? 'step')}${tone}${gate ? ' gate' : ''}" tabindex="0" role="img" aria-label="${FigureLayout.escaped(node.label)}${node.sublabel === undefined ? '' : `, ${FigureLayout.escaped(node.sublabel)}`}" data-node="${FigureLayout.escaped(node.id)}" data-detail="${FigureLayout.escaped(node.detail ?? node.sublabel ?? node.label)}"><title>${FigureLayout.escaped(node.label)}</title><rect x="${left}" y="${top}" width="${box.width}" height="${box.height}" rx="4"/>${mark}${titles}${subtitles}</g>`;
      })
      .join('');

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="flow"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path class="ah" d="M0 0L10 5L0 10z"/></marker><marker id="e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path class="bad" d="M0 0L10 5L0 10z"/></marker><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="15" markerHeight="15" markerUnits="userSpaceOnUse" orient="auto"><path class="hot" d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}</svg>`;
  }

  /**
   * The same flow as a list, for a phone where the figure cannot be read: one row per arrow, then one per box that
   * has a detail. Page CSS shows it only on a narrow screen.
   */
  static renderPathList(opts: { flow: TFlow }): string {
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
