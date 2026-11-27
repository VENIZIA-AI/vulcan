import { KindFigureConstants } from './constants.ts';
import type { IKindDrawing } from './common/index.ts';
import type { TChrome } from './constants.ts';
import { FigureLayout } from './layout.ts';
import { LifecycleKinds } from './kinds-schema.ts';
import type { TLifecycle } from './kinds-schema.ts';
import { KindFigureUtility } from './utilities/kind-figure.utility.ts';

// -----------------------------------------------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------------------------------------------

type TState = TLifecycle['states'][number];

const BOX_WIDTH = 148;
const GAP = 104;
const LEFT = 48;
const LEVEL = 22;

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

/** The figure of a lifecycle: the states of a thing and the transitions between them. */
export class LifecycleBuilder {
  /** From the start by the transitions, breadth first; the ends last, so the figure runs toward them. */
  private static orderStates(opts: { lifecycle: TLifecycle }): TState[] {
    const { lifecycle } = opts;
    const byId = new Map(lifecycle.states.map((state) => [state.id, state]));
    const start = lifecycle.states.find((state) => state.type === LifecycleKinds.START);
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
      ...found.filter((state) => state.type !== LifecycleKinds.END),
      ...found.filter((state) => state.type === LifecycleKinds.END),
    ];
  }

  /** The offset of the n-th line leaving one side of a box: the middle, then to either side. */
  private static portOffset(opts: { index: number }): number {
    return opts.index === 0
      ? 0
      : Math.max(
          -64,
          Math.min(64, (opts.index % 2 === 1 ? 1 : -1) * Math.ceil(opts.index / 2) * 16),
        );
  }

  static build(opts: { lifecycle: TLifecycle; chrome: TChrome }): IKindDrawing {
    const { lifecycle, chrome } = opts;
    const order = LifecycleBuilder.orderStates({ lifecycle });
    const count = order.length;
    const perRow = count <= 4 ? count : Math.ceil(count / 2);
    const rows = count <= 4 ? 1 : 2;
    const places = new Map(
      order.map((state, index) => {
        const row = index < perRow ? 0 : 1;
        const col = row === 0 ? index : perRow - 1 - (index - perRow);

        return [state.id, { state, row, col }] as const;
      }),
    );
    const wordFor = (state: TState): string | undefined =>
      state.type === LifecycleKinds.START
        ? KindFigureUtility.wordOf({ chrome, key: 'stateStart' })
        : state.type === LifecycleKinds.END
          ? KindFigureUtility.wordOf({ chrome, key: 'stateEnd' })
          : undefined;
    const contents = order.map((state) => {
      const labelLines = KindFigureUtility.wrapLines({
        text: state.label,
        chars: Math.floor((BOX_WIDTH - 24) / KindFigureConstants.LABEL_PX),
      });
      const subLines =
        state.sublabel === undefined
          ? []
          : KindFigureUtility.wrapLines({
              text: state.sublabel,
              chars: Math.floor((BOX_WIDTH - 24) / KindFigureConstants.SMALL_PX),
            });
      const word = wordFor(state);
      const first = 24;
      const last = first + (labelLines.length - 1) * 17;
      const bottom = subLines.length === 0 ? last : last + 17 + (subLines.length - 1) * 15;

      return { state, labelLines, subLines, word, first, last, height: bottom + 14 };
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
        route.gutter =
          rows === 1 ? (b.col > a.col ? 'top' : 'bottom') : a.row === 0 ? 'top' : 'bottom';
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
    const width = Math.max(
      KindFigureConstants.MIN_WIDTH,
      LEFT + perRow * BOX_WIDTH + (perRow - 1) * GAP + KindFigureConstants.MARGIN,
    );
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

    const take = (port: { id: string; side: TSide }): number => {
      const key = `${port.id}:${port.side}`;
      const index = ports.get(key) ?? 0;

      ports.set(key, index + 1);

      return LifecycleBuilder.portOffset({ index });
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
        const label = KindFigureUtility.wrapLines({
          text: route.label,
          chars: Math.floor((GAP - 16) / 6.6),
        });
        const above = !double || right;
        const labelY = above ? y - 7 - (label.length - 1) * 14 : y + 17;

        return {
          line: `<path class="kline" d="M${x1} ${y}H${x2}"/>${KindFigureUtility.head({ x: x2, y, dx: sign, dy: 0 })}`,
          text: KindFigureUtility.textLines({
            cls: labelHalo,
            x: (x1 + x2) / 2,
            y: labelY,
            lines: label,
            step: 14,
            anchor: 'middle',
          }),
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
          line: `<path class="kline" d="M${x} ${y1}V${y2}"/>${KindFigureUtility.head({ x, y: y2, dx: 0, dy: down ? 1 : -1 })}`,
          text: `<text class="${labelHalo}" x="${left ? x - 8 : x + 8}" y="${(y1 + y2) / 2 + 4}" text-anchor="${left ? 'end' : 'start'}">${FigureLayout.escapeText({ value: route.label })}</text>`,
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
          line: `<path class="kline" d="M${x1} ${y1}V${level}H${x2}V${y2}"/>${KindFigureUtility.head({ x: x2, y: y2, dx: 0, dy: down ? 1 : -1 })}`,
          text: `<text class="${labelHalo}" x="${(x1 + x2) / 2}" y="${level - 6}" text-anchor="middle">${FigureLayout.escapeText({ value: route.label })}</text>`,
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
        line: `<path class="kline" d="M${x1} ${edge}V${level}H${x2}V${edge}"/>${KindFigureUtility.head({ x: x2, y: edge, dx: 0, dy: side === 'top' ? 1 : -1 })}`,
        text: `<text class="${labelHalo}" x="${(x1 + x2) / 2}" y="${level - 6}" text-anchor="middle">${FigureLayout.escapeText({ value: route.label })}</text>`,
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
        const kind = item.state.type ?? LifecycleKinds.NORMAL;

        return `<g class="kstate kk-${kind}">${item.word === undefined ? '' : `<title>${FigureLayout.escapeText({ value: item.word })}</title>`}<rect class="kbox" x="${x}" y="${y}" width="${BOX_WIDTH}" height="${boxHeight}" rx="4"/>${kind === LifecycleKinds.END ? `<rect class="kinner" x="${x + 5}" y="${y + 5}" width="${BOX_WIDTH - 10}" height="${boxHeight - 10}" rx="2"/>` : ''}${KindFigureUtility.textLines({ cls: 'kt', x: x + 14, y: y + item.first, lines: item.labelLines, step: 17 })}${item.subLines.length === 0 ? '' : KindFigureUtility.textLines({ cls: 'ks', x: x + 14, y: y + item.last + 17, lines: item.subLines, step: 15 })}</g>`;
      })
      .join('');
    const [first] = order;
    const firstPlace = first === undefined ? undefined : places.get(first.id);
    const marker =
      first !== undefined &&
      first.type === LifecycleKinds.START &&
      firstPlace !== undefined &&
      firstPlace.row === 0 &&
      firstPlace.col === 0
        ? `<g class="klink"><circle class="kdot" cx="14" cy="${rowTop(0) + boxHeight / 2}" r="7"/><path class="kline" d="M22 ${rowTop(0) + boxHeight / 2}H${LEFT - 2}"/>${KindFigureUtility.head({ x: LEFT - 2, y: rowTop(0) + boxHeight / 2, dx: 1, dy: 0 })}</g>`
        : '';
    const nameOf = (id: string): string =>
      lifecycle.states.find((state) => state.id === id)?.label ?? id;
    const label = `${chrome.lifecycle}: ${order.map((state) => state.label).join(', ')}`;

    return {
      svg: KindFigureUtility.svgOf({
        width,
        height,
        label,
        body: `${marker}${lines}${boxes}${labels}`,
      }),
      width,
      list: `<ul class="path kl klc">${order
        .map((state) => {
          const word = wordFor(state);
          const out = lifecycle.transitions.filter((transition) => transition.from === state.id);

          return `<li class="kst kk-${state.type ?? LifecycleKinds.NORMAL}"><b>${FigureLayout.escapeText({ value: state.label })}</b>${state.sublabel === undefined ? '' : ` <span class="mut">${FigureLayout.escapeText({ value: state.sublabel })}</span>`}${word === undefined ? '' : ` <span class="kword">${FigureLayout.escapeText({ value: word })}</span>`}${out.length === 0 ? '' : `<ul class="kout">${out.map((transition) => `<li><span class="verb">${FigureLayout.escapeText({ value: transition.label })}</span><b>${FigureLayout.escapeText({ value: nameOf(transition.to) })}</b></li>`).join('')}</ul>`}</li>`;
        })
        .join('')}</ul>`,
      caption:
        lifecycle.caption ??
        `${order.length} ${KindFigureUtility.wordOf({ chrome, key: 'countStates' })}, ${lifecycle.transitions.length} ${KindFigureUtility.wordOf({ chrome, key: 'countTransitions' })}`,
      label,
    };
  }
}
