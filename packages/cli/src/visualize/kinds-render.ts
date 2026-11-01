import { stateIcon } from './charts.ts';
import type { TChrome } from './constants.ts';
import { escapeText } from './layout.ts';
import { LifecycleKinds, MessageKinds } from './kinds-schema.ts';
import type { ITreeNode, TLifecycle, TSequence, TTree } from './kinds-schema.ts';
import type { INewKindsSpec } from './kinds-validate.ts';
import { chip, section, stateWord } from './sections.ts';

/** What a section of the new kinds needs: its slice of the spec, the page's words, and the figure widths to register. */
export interface INewKindsContext {
  spec: INewKindsSpec;
  chrome: TChrome;
  fits: Set<number>;
}

/** A figure, the width it needs to keep its text readable, the list that replaces it on a phone, and its sentences. */
export interface IKindDrawing {
  svg: string;
  width: number;
  list: string;
  caption: string;
  label: string;
}

/** The few words these figures say that the page's words may not have yet: English until the chrome has them. */
const KIND_WORDS = {
  kindCall: 'call',
  kindReply: 'reply',
  kindAsync: 'async',
  stateStart: 'start',
  stateEnd: 'end',
  countMessages: 'messages',
  countStates: 'states',
  countTransitions: 'transitions',
  countItems: 'items',
} as const;

const escaped = (value: string): string => escapeText({ value });

const wordOf = (opts: { chrome: TChrome; key: keyof typeof KIND_WORDS }): string => {
  const given: Record<string, unknown> = opts.chrome;
  const value = given[opts.key];

  return typeof value === 'string' ? value : KIND_WORDS[opts.key];
};

const MARGIN = 24;
/** No figure is narrower than this, so on a phone (390 px) the list always takes its place. */
const MIN_WIDTH = 480;
const LABEL_PX = 8.2;
const SMALL_PX = 6.6;

/** Greedy wrap into lines of at most `chars` characters; a word longer than a line is cut. */
const wrapLines = (opts: { text: string; chars: number }): string[] => {
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
};

/** One `<text>` of several lines; a line ends with a space so the text reads whole without the layout. */
const textLines = (opts: {
  cls: string;
  x: number;
  y: number;
  lines: string[];
  step: number;
  anchor?: string;
}): string =>
  `<text class="${opts.cls}" x="${opts.x}" y="${opts.y}"${opts.anchor === undefined ? '' : ` text-anchor="${opts.anchor}"`}>${opts.lines
    .map(
      (line, index) =>
        `<tspan x="${opts.x}" dy="${index === 0 ? 0 : opts.step}">${escaped(line)}${index < opts.lines.length - 1 ? ' ' : ''}</tspan>`,
    )
    .join('')}</text>`;

/** An arrowhead at a tip, pointing along (dx, dy): filled, or two open strokes. */
const head = (opts: { x: number; y: number; dx: number; dy: number; open?: boolean }): string => {
  const { x, y, dx, dy } = opts;
  const bx = x - dx * 10;
  const by = y - dy * 10;
  const px = -dy * 5;
  const py = dx * 5;

  return opts.open === true
    ? `<path class="kopen" d="M${bx + px} ${by + py}L${x} ${y}L${bx - px} ${by - py}"/>`
    : `<path class="khead" d="M${x} ${y}L${bx + px} ${by + py}L${bx - px} ${by - py}Z"/>`;
};

const svgOf = (opts: { width: number; height: number; label: string; body: string }): string =>
  `<svg class="kf" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}" role="group" aria-label="${escaped(opts.label)}">${opts.body}</svg>`;

// -----------------------------------------------------------------------------------------------------------------
// Sequence
// -----------------------------------------------------------------------------------------------------------------

const MESSAGE_WORD: Record<string, keyof typeof KIND_WORDS> = {
  call: 'kindCall',
  reply: 'kindReply',
  async: 'kindAsync',
};

const renderSequence = (opts: { sequence: TSequence; chrome: TChrome }): IKindDrawing => {
  const { sequence, chrome } = opts;
  const count = sequence.participants.length;
  const lane = Math.max(190, Math.floor(600 / count));
  const width = MARGIN * 2 + count * lane;
  const boxWidth = lane - 24;
  const centre = (index: number): number => MARGIN + lane * index + lane / 2;
  const positions = new Map(sequence.participants.map((part, index) => [part.id, index]));
  const heads = sequence.participants.map((part) => {
    const labelLines = wrapLines({
      text: part.label,
      chars: Math.floor((boxWidth - 20) / LABEL_PX),
    });
    const subLines =
      part.sublabel === undefined
        ? []
        : wrapLines({ text: part.sublabel, chars: Math.floor((boxWidth - 20) / SMALL_PX) });
    const last = 24 + (labelLines.length - 1) * 17;
    const bottom = subLines.length === 0 ? last : last + 17 + (subLines.length - 1) * 15;

    return { part, labelLines, subLines, last, height: bottom + 14 };
  });
  const headHeight = Math.max(...heads.map((item) => item.height));
  const hasNote = sequence.messages.some((message) => message.note !== undefined);
  const rowHeight = hasNote ? 66 : 52;
  const firstY = 8 + headHeight + (hasNote ? 48 : 40);
  const lastY = firstY + (sequence.messages.length - 1) * rowHeight;
  const kinds = [...new Set(sequence.messages.map((message) => message.kind ?? MessageKinds.CALL))];
  const legendHeight = kinds.length > 1 ? 34 : 0;
  const height = lastY + (hasNote ? 40 : 28) + legendHeight;
  const lifelines = heads
    .map(
      (_, index) =>
        `<path class="klife" d="M${centre(index)} ${8 + headHeight}V${height - legendHeight - 8}"/>`,
    )
    .join('');
  const boxes = heads
    .map((item, index) => {
      const x = centre(index) - boxWidth / 2;

      return `<g><rect class="kbox" x="${x}" y="8" width="${boxWidth}" height="${headHeight}" rx="4"/>${textLines({ cls: 'kt', x: centre(index), y: 8 + 24, lines: item.labelLines, step: 17, anchor: 'middle' })}${item.subLines.length === 0 ? '' : textLines({ cls: 'ks', x: centre(index), y: 8 + item.last + 17, lines: item.subLines, step: 15, anchor: 'middle' })}</g>`;
    })
    .join('');
  const messages = sequence.messages
    .map((message, order) => {
      const from = positions.get(message.from);
      const to = positions.get(message.to);

      if (from === undefined || to === undefined || from === to) {
        return '';
      }

      const kind = message.kind ?? MessageKinds.CALL;
      const sign = to > from ? 1 : -1;
      const y = firstY + order * rowHeight;
      const x1 = centre(from) + sign * 6;
      const x2 = centre(to) - sign * 6;

      return `<g class="kmsg k-${kind}">${message.note === undefined ? '' : `<title>${escaped(message.note)}</title>`}<path class="kline${kind === MessageKinds.REPLY ? ' kdash' : ''}" d="M${x1} ${y}H${x2}"/>${head({ x: x2, y, dx: sign, dy: 0, open: kind === MessageKinds.ASYNC })}<text class="ke kh" x="${(x1 + x2) / 2}" y="${y - 9}" text-anchor="middle"><tspan class="knum">${order + 1}.</tspan> ${escaped(message.label)}</text>${message.note === undefined ? '' : `<text class="ks kh" x="${(x1 + x2) / 2}" y="${y + 18}" text-anchor="middle">${escaped(message.note)}</text>`}</g>`;
    })
    .join('');
  const legend =
    kinds.length > 1
      ? kinds
          .map((kind, index) => {
            const x = MARGIN + index * 150;
            const y = height - 18;

            return `<g class="klegend"><path class="kline${kind === MessageKinds.REPLY ? ' kdash' : ''}" d="M${x} ${y}H${x + 34}"/>${head({ x: x + 34, y, dx: 1, dy: 0, open: kind === MessageKinds.ASYNC })}<text class="ks" x="${x + 46}" y="${y + 4}">${escaped(wordOf({ chrome, key: MESSAGE_WORD[kind] ?? 'kindCall' }))}</text></g>`;
          })
          .join('')
      : '';
  const names = sequence.participants.map((part) => part.label).join(', ');
  const nameOf = (id: string): string =>
    sequence.participants.find((part) => part.id === id)?.label ?? id;

  return {
    svg: svgOf({
      width,
      height,
      label: `${chrome.sequence}: ${names}`,
      body: `${lifelines}${boxes}${messages}${legend}`,
    }),
    width,
    list: `<div class="path kl ksq"><ul class="kparts">${sequence.participants.map((part) => `<li><b>${escaped(part.label)}</b>${part.sublabel === undefined ? '' : ` <span class="mut">${escaped(part.sublabel)}</span>`}</li>`).join('')}</ul><ol class="kmsgs">${sequence.messages
      .map((message) => {
        const kind = message.kind ?? MessageKinds.CALL;

        return `<li class="k-${kind}"><b>${escaped(nameOf(message.from))}</b><span class="verb kv-${kind}">${escaped(message.label)}</span><b>${escaped(nameOf(message.to))}</b>${kind === MessageKinds.CALL ? '' : ` <span class="kword">${escaped(wordOf({ chrome, key: MESSAGE_WORD[kind] ?? 'kindCall' }))}</span>`}${message.note === undefined ? '' : `<span class="knote">${escaped(message.note)}</span>`}</li>`;
      })
      .join('')}</ol></div>`,
    caption:
      sequence.caption ??
      `${names}: ${sequence.messages.length} ${wordOf({ chrome, key: 'countMessages' })}`,
    label: `${chrome.sequence}: ${names}`,
  };
};

// -----------------------------------------------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------------------------------------------

type TState = TLifecycle['states'][number];

/** From the start by the transitions, breadth first; the ends last, so the figure runs toward them. */
const orderStates = (opts: { lifecycle: TLifecycle }): TState[] => {
  const { lifecycle } = opts;
  const byId = new Map(lifecycle.states.map((state) => [state.id, state]));
  const start = lifecycle.states.find((state) => state.kind === LifecycleKinds.START);
  const seen = new Set<string>();
  const found: TState[] = [];
  const queue = start === undefined ? [] : [start.id];

  if (start !== undefined) {
    seen.add(start.id);
  }

  while (queue.length > 0) {
    const at = queue.shift() ?? '';
    const state = byId.get(at);

    if (state !== undefined) {
      found.push(state);
    }

    for (const transition of lifecycle.transitions) {
      if (transition.from === at && byId.has(transition.to) && !seen.has(transition.to)) {
        seen.add(transition.to);
        queue.push(transition.to);
      }
    }
  }

  for (const state of lifecycle.states) {
    if (!seen.has(state.id)) {
      found.push(state);
    }
  }

  return [
    ...found.filter((state) => state.kind !== LifecycleKinds.END),
    ...found.filter((state) => state.kind === LifecycleKinds.END),
  ];
};

const BOX_WIDTH = 148;
const GAP = 104;
const LEFT = 48;
const LEVEL = 22;

/** The offset of the n-th line leaving one side of a box: the middle, then to either side. */
const portOffset = (opts: { index: number }): number =>
  opts.index === 0
    ? 0
    : Math.max(-64, Math.min(64, (opts.index % 2 === 1 ? 1 : -1) * Math.ceil(opts.index / 2) * 16));

type TSide = 'top' | 'bottom';

interface IRoute {
  from: string;
  to: string;
  label: string;
  /** `h` and `v` are straight between neighbours, `arc` runs over or under a row, `cross` through the gap between rows. */
  shape: 'h' | 'v' | 'arc' | 'cross';
  gutter?: 'top' | 'gap' | 'bottom';
  level?: number;
}

const renderLifecycle = (opts: { lifecycle: TLifecycle; chrome: TChrome }): IKindDrawing => {
  const { lifecycle, chrome } = opts;
  const order = orderStates({ lifecycle });
  const count = order.length;
  const perRow = count <= 5 ? count : Math.ceil(count / 2);
  const rows = count <= 5 ? 1 : 2;
  const places = new Map(
    order.map((state, index) => {
      const row = index < perRow ? 0 : 1;
      const col = row === 0 ? index : perRow - 1 - (index - perRow);

      return [state.id, { state, row, col }] as const;
    }),
  );
  const wordFor = (state: TState): string | undefined =>
    state.kind === LifecycleKinds.START
      ? wordOf({ chrome, key: 'stateStart' })
      : state.kind === LifecycleKinds.END
        ? wordOf({ chrome, key: 'stateEnd' })
        : undefined;
  const contents = order.map((state) => {
    const labelLines = wrapLines({
      text: state.label,
      chars: Math.floor((BOX_WIDTH - 24) / LABEL_PX),
    });
    const subLines =
      state.sublabel === undefined
        ? []
        : wrapLines({ text: state.sublabel, chars: Math.floor((BOX_WIDTH - 24) / SMALL_PX) });
    const word = wordFor(state);
    const wordBase = 21;
    const first = word === undefined ? 24 : 40;
    const last = first + (labelLines.length - 1) * 17;
    const bottom = subLines.length === 0 ? last : last + 17 + (subLines.length - 1) * 15;

    return { state, labelLines, subLines, word, wordBase, first, last, height: bottom + 14 };
  });
  const boxHeight = Math.max(72, ...contents.map((item) => item.height));

  // Classify every transition, and give each line that runs around a row its own level, so no two share one.
  const used = { top: 0, gap: 0, bottom: 0 };
  const pairs = new Map<string, number>();
  const routes: IRoute[] = [];

  for (const transition of lifecycle.transitions) {
    const a = places.get(transition.from);
    const b = places.get(transition.to);

    if (a === undefined || b === undefined || a === b) {
      continue;
    }

    const route: IRoute = {
      from: transition.from,
      to: transition.to,
      label: transition.label,
      shape: 'arc',
    };

    if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
      route.shape = 'h';
    } else if (a.row !== b.row && a.col === b.col) {
      route.shape = 'v';
    } else if (a.row !== b.row) {
      route.shape = 'cross';
      route.gutter = 'gap';
      route.level = used.gap;
      used.gap += 1;
    } else {
      route.gutter = rows === 1 ? (b.col > a.col ? 'top' : 'bottom') : a.row === 0 ? 'top' : 'bottom';
      route.level = used[route.gutter];
      used[route.gutter] += 1;
    }

    if (route.shape === 'h' || route.shape === 'v') {
      const key = [transition.from, transition.to].sort().join('>');

      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }

    routes.push(route);
  }

  const topGutter = used.top === 0 ? 16 : 30 + used.top * LEVEL;
  const gapGutter = rows === 1 ? 0 : Math.max(80, 40 + used.gap * LEVEL);
  const bottomGutter = used.bottom === 0 ? 16 : 36 + used.bottom * LEVEL;
  const rowTop = (row: number): number => topGutter + row * (boxHeight + gapGutter);
  const colX = (col: number): number => LEFT + col * (BOX_WIDTH + GAP);
  const width = Math.max(MIN_WIDTH, LEFT + perRow * BOX_WIDTH + (perRow - 1) * GAP + MARGIN);
  const height = topGutter + rows * boxHeight + (rows - 1) * gapGutter + bottomGutter;
  const ports = new Map<string, number>();

  // A straight line between two stacked boxes sits in the middle of their facing sides: arcs start beside it.
  for (const route of routes) {
    const a = places.get(route.from);
    const b = places.get(route.to);

    if (route.shape === 'v' && a !== undefined && b !== undefined) {
      ports.set(`${a.state.id}:${a.row === 0 ? 'bottom' : 'top'}`, 1);
      ports.set(`${b.state.id}:${b.row === 0 ? 'bottom' : 'top'}`, 1);
    }
  }

  const take = (opts: { id: string; side: TSide }): number => {
    const key = `${opts.id}:${opts.side}`;
    const index = ports.get(key) ?? 0;

    ports.set(key, index + 1);

    return portOffset({ index });
  };
  const drawn = routes.map((route): { line: string; text: string } => {
      const a = places.get(route.from);
      const b = places.get(route.to);

      if (a === undefined || b === undefined) {
        return { line: '', text: '' };
      }

      const double = (pairs.get([route.from, route.to].sort().join('>')) ?? 0) > 1;
      const labelHalo = 'ke kh';

      if (route.shape === 'h') {
        const right = b.col > a.col;
        const offset = double ? (right ? -9 : 9) : 0;
        const y = rowTop(a.row) + boxHeight / 2 + offset;
        const x1 = right ? colX(a.col) + BOX_WIDTH : colX(a.col);
        const x2 = right ? colX(b.col) : colX(b.col) + BOX_WIDTH;
        const sign = right ? 1 : -1;
        const label = wrapLines({ text: route.label, chars: Math.floor((GAP - 16) / 6.6) });
        const above = !double || right;
        const labelY = above ? y - 7 - (label.length - 1) * 14 : y + 17;

        return {
          line: `<path class="kline" d="M${x1} ${y}H${x2}"/>${head({ x: x2, y, dx: sign, dy: 0 })}`,
          text: textLines({ cls: labelHalo, x: (x1 + x2) / 2, y: labelY, lines: label, step: 14, anchor: 'middle' }),
        };
      }

      if (route.shape === 'v') {
        const down = b.row > a.row;
        const offset = double ? (down ? -9 : 9) : 0;
        const x = colX(a.col) + BOX_WIDTH / 2 + offset;
        const y1 = down ? rowTop(a.row) + boxHeight : rowTop(a.row);
        const y2 = down ? rowTop(b.row) : rowTop(b.row) + boxHeight;
        const left = double && down;

        return {
          line: `<path class="kline" d="M${x} ${y1}V${y2}"/>${head({ x, y: y2, dx: 0, dy: down ? 1 : -1 })}`,
          text: `<text class="${labelHalo}" x="${left ? x - 8 : x + 8}" y="${(y1 + y2) / 2 + 4}" text-anchor="${left ? 'end' : 'start'}">${escaped(route.label)}</text>`,
        };
      }

      if (route.shape === 'cross') {
        const aSide: TSide = a.row === 0 ? 'bottom' : 'top';
        const bSide: TSide = b.row === 0 ? 'bottom' : 'top';
        const x1 = colX(a.col) + BOX_WIDTH / 2 + take({ id: a.state.id, side: aSide });
        const x2 = colX(b.col) + BOX_WIDTH / 2 + take({ id: b.state.id, side: bSide });
        const down = b.row > a.row;
        const y1 = aSide === 'bottom' ? rowTop(a.row) + boxHeight : rowTop(a.row);
        const y2 = bSide === 'bottom' ? rowTop(b.row) + boxHeight : rowTop(b.row);
        const level = rowTop(0) + boxHeight + 28 + (route.level ?? 0) * LEVEL;

        return {
          line: `<path class="kline" d="M${x1} ${y1}V${level}H${x2}V${y2}"/>${head({ x: x2, y: y2, dx: 0, dy: down ? 1 : -1 })}`,
          text: `<text class="${labelHalo}" x="${(x1 + x2) / 2}" y="${level - 6}" text-anchor="middle">${escaped(route.label)}</text>`,
        };
      }

      // An arc over the top of a row, or under the bottom of it.
      const side: TSide = route.gutter === 'top' ? 'top' : 'bottom';
      const x1 = colX(a.col) + BOX_WIDTH / 2 + take({ id: a.state.id, side });
      const x2 = colX(b.col) + BOX_WIDTH / 2 + take({ id: b.state.id, side });
      const edge = side === 'top' ? rowTop(a.row) : rowTop(a.row) + boxHeight;
      const level =
        side === 'top'
          ? rowTop(0) - 24 - (route.level ?? 0) * LEVEL
          : rowTop(rows - 1) + boxHeight + 24 + (route.level ?? 0) * LEVEL;

      return {
        line: `<path class="kline" d="M${x1} ${edge}V${level}H${x2}V${edge}"/>${head({ x: x2, y: edge, dx: 0, dy: side === 'top' ? 1 : -1 })}`,
        text: `<text class="${labelHalo}" x="${(x1 + x2) / 2}" y="${level - 6}" text-anchor="middle">${escaped(route.label)}</text>`,
      };
  });
  const lines = drawn.map((item) => item.line).join('');
  const labels = drawn.map((item) => item.text).join('');
  const boxes = contents
    .map((item) => {
      const place = places.get(item.state.id);

      if (place === undefined) {
        return '';
      }

      const x = colX(place.col);
      const y = rowTop(place.row);
      const kind = item.state.kind ?? LifecycleKinds.NORMAL;

      return `<g class="kstate kk-${kind}"><rect class="kbox" x="${x}" y="${y}" width="${BOX_WIDTH}" height="${boxHeight}" rx="4"/>${kind === LifecycleKinds.END ? `<rect class="kinner" x="${x + 5}" y="${y + 5}" width="${BOX_WIDTH - 10}" height="${boxHeight - 10}" rx="2"/>` : ''}${item.word === undefined ? '' : `<text class="kw" x="${x + 14}" y="${y + item.wordBase}">${escaped(item.word)}</text>`}${textLines({ cls: 'kt', x: x + 14, y: y + item.first, lines: item.labelLines, step: 17 })}${item.subLines.length === 0 ? '' : textLines({ cls: 'ks', x: x + 14, y: y + item.last + 17, lines: item.subLines, step: 15 })}</g>`;
    })
    .join('');
  const [first] = order;
  const firstPlace = first === undefined ? undefined : places.get(first.id);
  const marker =
    first !== undefined &&
    first.kind === LifecycleKinds.START &&
    firstPlace !== undefined &&
    firstPlace.row === 0 &&
    firstPlace.col === 0
      ? `<g class="klink"><circle class="kdot" cx="14" cy="${rowTop(0) + boxHeight / 2}" r="7"/><path class="kline" d="M22 ${rowTop(0) + boxHeight / 2}H${LEFT - 2}"/>${head({ x: LEFT - 2, y: rowTop(0) + boxHeight / 2, dx: 1, dy: 0 })}</g>`
      : '';
  const nameOf = (id: string): string =>
    lifecycle.states.find((state) => state.id === id)?.label ?? id;
  const label = `${chrome.lifecycle}: ${order.map((state) => state.label).join(', ')}`;

  return {
    svg: svgOf({ width, height, label, body: `${marker}${lines}${boxes}${labels}` }),
    width,
    list: `<ul class="path kl klc">${order
      .map((state) => {
        const word = wordFor(state);
        const out = lifecycle.transitions.filter((transition) => transition.from === state.id);

        return `<li class="kst kk-${state.kind ?? LifecycleKinds.NORMAL}"><b>${escaped(state.label)}</b>${state.sublabel === undefined ? '' : ` <span class="mut">${escaped(state.sublabel)}</span>`}${word === undefined ? '' : ` <span class="kword">${escaped(word)}</span>`}${out.length === 0 ? '' : `<ul class="kout">${out.map((transition) => `<li><span class="verb">${escaped(transition.label)}</span><b>${escaped(nameOf(transition.to))}</b></li>`).join('')}</ul>`}</li>`;
      })
      .join('')}</ul>`,
    caption:
      lifecycle.caption ??
      `${order.length} ${wordOf({ chrome, key: 'countStates' })}, ${lifecycle.transitions.length} ${wordOf({ chrome, key: 'countTransitions' })}`,
    label,
  };
};

// -----------------------------------------------------------------------------------------------------------------
// Tree
// -----------------------------------------------------------------------------------------------------------------

interface IRow {
  node: ITreeNode;
  depth: number;
  parent: number | undefined;
}

const INDENT = 36;
const TREE_TOP = 12;
const ROW_GAP = 10;

const renderTree = (opts: { tree: TTree; chrome: TChrome }): IKindDrawing => {
  const { tree, chrome } = opts;
  const rows: IRow[] = [];
  const walk = (node: ITreeNode, depth: number, parent: number | undefined): void => {
    const index = rows.length;

    rows.push({ node, depth, parent });

    for (const child of node.children ?? []) {
      walk(child, depth + 1, index);
    }
  };

  walk(tree.root, 0, undefined);

  const sized = rows.map((row) => {
    const word = row.node.state === undefined ? undefined : stateWord({ chrome, state: row.node.state });
    const hasSub = row.node.sublabel !== undefined;
    const icon = row.node.state === undefined ? 0 : 26;
    const wordWidth = word === undefined ? 0 : Math.ceil(word.length * 7.4) + 20;
    const textWidth = Math.max(
      Math.ceil(row.node.label.length * LABEL_PX) + wordWidth,
      Math.ceil((row.node.sublabel?.length ?? 0) * SMALL_PX),
    );
    const boxWidth = Math.max(160, textWidth + 28 + icon);

    return { ...row, word, hasSub, icon, boxWidth, boxHeight: hasSub ? 50 : 36 };
  });
  let cursor = TREE_TOP;
  const placed = sized.map((row) => {
    const placement = { ...row, x: MARGIN + row.depth * INDENT, y: cursor };

    cursor += row.boxHeight + ROW_GAP;

    return placement;
  });
  const width = Math.max(MIN_WIDTH, Math.max(...placed.map((row) => row.x + row.boxWidth)) + MARGIN);
  const height = cursor - ROW_GAP + TREE_TOP;
  const guides = placed
    .map((row, index) => {
      const children = placed.filter((other) => other.parent === index);

      if (children.length === 0) {
        return '';
      }

      const trunk = row.x + 14;
      const lastCentre = Math.max(...children.map((child) => child.y + child.boxHeight / 2));

      return `<path class="kguide" d="M${trunk} ${row.y + row.boxHeight}V${lastCentre}${children.map((child) => `M${trunk} ${child.y + child.boxHeight / 2}H${child.x}`).join('')}"/>`;
    })
    .join('');
  const boxes = placed
    .map((row) => {
      const centre = row.y + row.boxHeight / 2;
      const textX = row.x + 14 + row.icon;
      const state = row.node.state;

      return `<g class="knode${state === undefined ? '' : ` kn-${state.replaceAll(' ', '-')}`}"><rect class="kbox" x="${row.x}" y="${row.y}" width="${row.boxWidth}" height="${row.boxHeight}" rx="4"/>${state === undefined ? '' : `<g class="kic" transform="translate(${row.x + 12} ${centre - 8})">${stateIcon({ state, size: 16 }).replace('<svg', '<svg x="0" y="0"')}</g>`}<text class="kt" x="${textX}" y="${row.hasSub ? row.y + 21 : centre + 5}">${escaped(row.node.label)}</text>${row.word === undefined ? '' : `<text class="kw" x="${row.x + row.boxWidth - 12}" y="${row.hasSub ? row.y + 21 : centre + 4}" text-anchor="end">${escaped(row.word)}</text>`}${row.node.sublabel === undefined ? '' : `<text class="ks" x="${textX}" y="${row.y + 39}">${escaped(row.node.sublabel)}</text>`}</g>`;
    })
    .join('');
  const outline = (node: ITreeNode): string => {
    const state = node.state === undefined ? '' : ` ${chip({ chrome, state: node.state })}`;
    const inner =
      node.children === undefined || node.children.length === 0
        ? ''
        : `<ul class="kt-in">${node.children.map(outline).join('')}</ul>`;

    return `<li><b>${escaped(node.label)}</b>${node.sublabel === undefined ? '' : ` <span class="mut">${escaped(node.sublabel)}</span>`}${state}${inner}</li>`;
  };
  const label = `${chrome.tree}: ${tree.root.label}`;

  return {
    svg: svgOf({ width, height, label, body: `${guides}${boxes}` }),
    width,
    list: `<ul class="path kl ktr">${outline(tree.root)}</ul>`,
    caption:
      tree.caption ??
      `${tree.root.label}: ${rows.length} ${wordOf({ chrome, key: 'countItems' })}`,
    label,
  };
};

// -----------------------------------------------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------------------------------------------

/** A figure in its frame, its list as a sibling for the page to swap in on a phone, and its caption. */
const frame = (opts: { ctx: INewKindsContext; drawing: IKindDrawing }): string => {
  const width = Math.round(opts.drawing.width);

  opts.ctx.fits.add(width);

  return `<figure class="kfig"><div class="fig f${width}">${opts.drawing.svg}</div>${opts.drawing.list}<figcaption>${escaped(opts.drawing.caption)}</figcaption></figure>`;
};

export const sequenceSection = (opts: { ctx: INewKindsContext }): string => {
  const { sequence } = opts.ctx.spec;

  return sequence === undefined
    ? ''
    : section({
        id: 'sequence',
        title: opts.ctx.chrome.sequence,
        body: frame({
          ctx: opts.ctx,
          drawing: renderSequence({ sequence, chrome: opts.ctx.chrome }),
        }),
      });
};

export const lifecycleSection = (opts: { ctx: INewKindsContext }): string => {
  const { lifecycle } = opts.ctx.spec;

  return lifecycle === undefined
    ? ''
    : section({
        id: 'lifecycle',
        title: opts.ctx.chrome.lifecycle,
        body: frame({
          ctx: opts.ctx,
          drawing: renderLifecycle({ lifecycle, chrome: opts.ctx.chrome }),
        }),
      });
};

export const treeSection = (opts: { ctx: INewKindsContext }): string => {
  const { tree } = opts.ctx.spec;

  return tree === undefined
    ? ''
    : section({
        id: 'tree',
        title: opts.ctx.chrome.tree,
        body: frame({ ctx: opts.ctx, drawing: renderTree({ tree, chrome: opts.ctx.chrome }) }),
      });
};
