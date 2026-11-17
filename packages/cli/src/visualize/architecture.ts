import { SpecCharts } from './charts.ts';
import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import type { IDrawing } from './diagrams.ts';
import { FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

type TArchitecture = NonNullable<TVisualizeSpec['architecture']>;
type TBox = TArchitecture['layers'][number]['boxes'][number];
type TLink = TArchitecture['links'][number];
type TSide = 'top' | 'bottom';
type TPoint = [number, number];

const PAD = 24;
const GAP = 48;
const MIN_BOX_WIDTH = 128;
const MAX_BOX_WIDTH = 192;
/** The widest the drawing is made: the content column, less its frame, holds it at 92% (see the fit rule of the page). */
const TARGET_WIDTH = 1270;
const TOP_ZONE = 32;
const BOTTOM_PAD = 14;
/** The least distance between two parallel lines, and so between two lanes, two margin lanes and two ends on one edge. */
const SPACING = 24;
const EDGE_INSET = 14;
const TITLE_SIZE = 14;
const SUB_SIZE = 12.5;
const LABEL_SIZE = 12.5;
const TITLE_LINE = 18;
const SUB_LINE = 15;
/** How far from its own line a label may sit, and how much closer it must be to it than to any other line. */
const LABEL_REACH = 12;
const LABEL_MARGIN = 6;

const escaped = (value: string): string => FigureLayout.escapeText({ value });

interface IRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface IPlacedBox {
  spec: TBox;
  row: number;
  x: number;
  centre: number;
  titleLines: string[];
  subLines: string[];
}

interface IStep {
  channel: number;
  lane: number;
}

interface IPlannedLink {
  link: TLink;
  from: IPlacedBox;
  to: IPlacedBox;
  fromSide: TSide;
  toSide: TSide;
  first: IStep;
  /** A link over more than one layer goes down the right margin: its second horizontal run and the lane of the margin. */
  second?: IStep;
  marginLane?: number;
}

const touches = (one: IRect, other: IRect): boolean =>
  one.left < other.right &&
  one.right > other.left &&
  one.top < other.bottom &&
  one.bottom > other.top;

const grow = (rect: IRect, by: number): IRect => ({
  left: rect.left - by,
  right: rect.right + by,
  top: rect.top - by,
  bottom: rect.bottom + by,
});

/** The distance from a rectangle to a straight axis-aligned segment (a rectangle of no thickness). */
const distanceTo = (opts: { rect: IRect; segment: IRect }): number => {
  const { rect, segment } = opts;
  const across = Math.max(rect.left - segment.right, segment.left - rect.right, 0);
  const down = Math.max(rect.top - segment.bottom, segment.top - rect.bottom, 0);

  return Math.hypot(across, down);
};

const legOf = (opts: { from: TPoint; to: TPoint }): IRect => ({
  left: Math.min(opts.from[0], opts.to[0]),
  right: Math.max(opts.from[0], opts.to[0]),
  top: Math.min(opts.from[1], opts.to[1]),
  bottom: Math.max(opts.from[1], opts.to[1]),
});

/**
 * The layered view: bands from top to bottom, boxes in each, and an orthogonal line for every link that never crosses
 * a box. Between two bands is a channel; a link runs along its own lane of it, so no two lines are closer than
 * SPACING, and a link over more than one layer goes down the right margin, which no box reaches. The ends of the
 * links on one edge of a box are spread to SPACING and lined up with their other end where they can be, so a line
 * is straight when it can be. Each label sits on its own line, nearer to it than to any other. The boxes are as wide
 * as the widest layer lets the drawing stay under TARGET_WIDTH, and their text wraps inside them.
 */
export class SpecArchitecture {
  static render(opts: { architecture: TArchitecture; chrome: TChrome }): IDrawing {
    const { architecture } = opts;
    const most = Math.max(...architecture.layers.map((layer) => layer.boxes.length));
    const rowOf = new Map<string, number>();

    architecture.layers.forEach((layer, row) =>
      layer.boxes.forEach((spec) => rowOf.set(spec.id, row)),
    );

    const known = architecture.links.filter((link) => rowOf.has(link.from) && rowOf.has(link.to));
    const farCount = known.filter(
      (link) => Math.abs((rowOf.get(link.from) ?? 0) - (rowOf.get(link.to) ?? 0)) > 1,
    ).length;
    const marginRoom = farCount === 0 ? 0 : 20 + SPACING * farCount;
    const boxWidth = Math.min(
      MAX_BOX_WIDTH,
      Math.max(
        MIN_BOX_WIDTH,
        Math.floor((TARGET_WIDTH - 2 * PAD - marginRoom - (most - 1) * GAP) / most),
      ),
    );
    const width = 2 * PAD + marginRoom + most * boxWidth + (most - 1) * GAP;
    const textWidthOf = (spec: TBox): number => boxWidth - (spec.state === undefined ? 24 : 50);
    const placed = new Map<string, IPlacedBox>();

    architecture.layers.forEach((layer, row) => {
      const total = layer.boxes.length * boxWidth + (layer.boxes.length - 1) * GAP;
      const start = PAD + (width - 2 * PAD - marginRoom - total) / 2;

      layer.boxes.forEach((spec, col) => {
        const x = start + col * (boxWidth + GAP);

        placed.set(spec.id, {
          spec,
          row,
          x,
          centre: x + boxWidth / 2,
          titleLines: FigureLayout.wrapText({
            text: spec.label,
            size: TITLE_SIZE,
            isBold: true,
            max: textWidthOf(spec),
          }),
          subLines:
            spec.sub === undefined
              ? []
              : FigureLayout.wrapText({ text: spec.sub, size: SUB_SIZE, max: textWidthOf(spec) }),
        });
      });
    });

    const textHeight = (box: IPlacedBox): number =>
      box.titleLines.length * TITLE_LINE +
      (box.subLines.length === 0 ? 0 : 4 + box.subLines.length * SUB_LINE);
    const boxHeight = Math.max(60, ...[...placed.values()].map((box) => 20 + textHeight(box)));

    // Plan each link: the edges it leaves and enters, and a lane of each channel it runs along.
    const lanes = new Map<number, number>();
    const take = (channel: number): IStep => {
      const lane = lanes.get(channel) ?? 0;

      lanes.set(channel, lane + 1);

      return { channel, lane };
    };
    let marginLanes = 0;
    const plans: IPlannedLink[] = known.map((link) => {
      const from = placed.get(link.from) as IPlacedBox;
      const to = placed.get(link.to) as IPlacedBox;
      const down = to.row >= from.row;
      const isSame = to.row === from.row;
      // A link between two boxes of one layer leaves and enters by the bottom edges, along the channel below the row.
      const fromSide: TSide = isSame || down ? 'bottom' : 'top';
      const toSide: TSide = isSame ? 'bottom' : down ? 'top' : 'bottom';

      if (Math.abs(to.row - from.row) <= 1) {
        return {
          link,
          from,
          to,
          fromSide,
          toSide,
          first: take(isSame ? from.row : Math.min(from.row, to.row)),
        };
      }

      marginLanes += 1;

      return {
        link,
        from,
        to,
        fromSide,
        toSide,
        first: take(down ? from.row : from.row - 1),
        second: take(down ? to.row - 1 : to.row),
        marginLane: marginLanes,
      };
    });

    // The ends on one edge of a box: lined up with the other end where the two boxes overlap, spread to SPACING.
    type TEnd = { index: number; end: 'from' | 'to'; wanted: number };
    const ends = new Map<string, TEnd[]>();
    const addEnd = (box: IPlacedBox, side: TSide, entry: TEnd): void => {
      const key = `${box.spec.id}:${side}`;

      ends.set(key, [...(ends.get(key) ?? []), entry]);
    };

    plans.forEach((plan, index) => {
      const low = Math.max(plan.from.x, plan.to.x) + EDGE_INSET;
      const high = Math.min(plan.from.x, plan.to.x) + boxWidth - EDGE_INSET;
      const shared = low <= high ? (low + high) / 2 : undefined;

      addEnd(plan.from, plan.fromSide, { index, end: 'from', wanted: shared ?? plan.to.centre });
      addEnd(plan.to, plan.toSide, { index, end: 'to', wanted: shared ?? plan.from.centre });
    });

    const xOf = new Map<string, number>();

    for (const [key, entries] of ends) {
      const box = placed.get(key.split(':')[0] ?? '') as IPlacedBox;
      const left = box.x + EDGE_INSET;
      const right = box.x + boxWidth - EDGE_INSET;
      const sorted = [...entries].sort(
        (one, other) => one.wanted - other.wanted || one.index - other.index,
      );
      const spacing =
        sorted.length < 2 ? 0 : Math.min(SPACING, (right - left) / (sorted.length - 1));
      const xs = sorted.map((entry) => Math.min(right, Math.max(left, entry.wanted)));

      for (let at = 1; at < xs.length; at += 1) {
        xs[at] = Math.max(xs[at] ?? 0, (xs[at - 1] ?? 0) + spacing);
      }

      for (let at = xs.length - 2; at >= 0; at -= 1) {
        xs[at] = Math.min(xs[at] ?? 0, (xs[at + 1] ?? 0) - spacing);
      }

      sorted.forEach((entry, at) => xOf.set(`${entry.index}:${entry.end}`, xs[at] ?? box.centre));
    }

    // A link whose two ends are less than a lane apart takes one x at both ends, so it has no step.
    plans.forEach((plan, index) => {
      const fromKey = `${index}:from`;
      const toKey = `${index}:to`;
      const fromX = xOf.get(fromKey) ?? 0;
      const toX = xOf.get(toKey) ?? 0;
      const move = (key: string, target: number, box: IPlacedBox, side: TSide): boolean => {
        const clash = (ends.get(`${box.spec.id}:${side}`) ?? []).some(
          (entry) =>
            `${entry.index}:${entry.end}` !== key &&
            Math.abs((xOf.get(`${entry.index}:${entry.end}`) ?? 0) - target) < SPACING,
        );

        if (clash || target < box.x + EDGE_INSET || target > box.x + boxWidth - EDGE_INSET) {
          return false;
        }

        xOf.set(key, target);

        return true;
      };

      if (
        fromX !== toX &&
        Math.abs(fromX - toX) < SPACING &&
        !move(toKey, fromX, plan.to, plan.toSide)
      ) {
        move(fromKey, toX, plan.from, plan.fromSide);
      }
    });

    // The geometry of bands and channels, from the lanes the links need.
    const rows = architecture.layers.length;
    const bandHeight = TOP_ZONE + boxHeight + BOTTOM_PAD;
    const channelHeight = (channel: number): number => {
      const count = lanes.get(channel) ?? 0;

      return count === 0 ? (channel === rows - 1 ? 6 : 24) : 24 + SPACING * count;
    };
    const bandTops: number[] = [];
    const channelTops: number[] = [];
    let y = 4;

    for (let row = 0; row < rows; row += 1) {
      bandTops.push(y);
      channelTops.push(y + bandHeight);
      y += bandHeight + channelHeight(row);
    }

    const height = y + 4;
    const boxTop = (row: number): number => (bandTops[row] ?? 0) + TOP_ZONE;
    const boxBottom = (row: number): number => boxTop(row) + boxHeight;
    const laneY = (step: IStep): number =>
      (channelTops[step.channel] ?? 0) + 22 + SPACING * step.lane;
    const marginX = (lane: number): number => width - PAD - marginRoom + 20 + SPACING * (lane - 1);
    const head = (point: { x: number; y: number; toward: 'up' | 'down' }): string => {
      const tip = point.toward === 'down' ? -7 : 7;

      return `<path d="M${point.x - 5} ${point.y + tip}L${point.x} ${point.y}L${point.x + 5} ${point.y + tip}" fill="none" class="dline"/>`;
    };

    const bands = architecture.layers
      .map(
        (layer, row) =>
          `<rect x="2" y="${bandTops[row]}" width="${width - 4}" height="${bandHeight}" rx="4" class="dband"/><text class="dlab" x="14" y="${(bandTops[row] ?? 0) + 22}">${escaped(layer.label)}</text>`,
      )
      .join('');
    // Every route first, so a label can be placed clear of the lines of the other links.
    const routes = plans.map((plan, index) => {
      const startX = xOf.get(`${index}:from`) ?? plan.from.centre;
      const endX = xOf.get(`${index}:to`) ?? plan.to.centre;
      const startY = plan.fromSide === 'bottom' ? boxBottom(plan.from.row) : boxTop(plan.from.row);
      const endY = plan.toSide === 'bottom' ? boxBottom(plan.to.row) : boxTop(plan.to.row);
      const first = laneY(plan.first);
      const points: TPoint[] =
        plan.second === undefined || plan.marginLane === undefined
          ? [
              [startX, startY],
              [startX, first],
              [endX, first],
              [endX, endY],
            ]
          : [
              [startX, startY],
              [startX, first],
              [marginX(plan.marginLane), first],
              [marginX(plan.marginLane), laneY(plan.second)],
              [endX, laneY(plan.second)],
              [endX, endY],
            ];

      return { plan, points, endX, endY };
    });
    const legsOf = (index: number): IRect[] => {
      const points = routes[index]?.points ?? [];

      return points.slice(1).map((point, at) => legOf({ from: points[at] ?? point, to: point }));
    };
    const boxRects: IRect[] = [...placed.values()].map((box) =>
      grow(
        { left: box.x, right: box.x + boxWidth, top: boxTop(box.row), bottom: boxBottom(box.row) },
        3,
      ),
    );
    const placedLabels: IRect[] = [];
    const labelOf = (index: number): string => {
      const route = routes[index];
      const label = route?.plan.link.label ?? opts.chrome.uses;

      if (route === undefined) {
        return '';
      }

      const textWidth = FigureLayout.textWidth({ text: label, size: LABEL_SIZE });
      const own = legsOf(index);
      const others = routes.flatMap((_, at) => (at === index ? [] : legsOf(at)));
      type TCandidate = { x: number; y: number; anchor: 'middle' | 'start' | 'end' };
      const candidates: TCandidate[] = [];
      const longestFirst = [...own].sort(
        (one, other) =>
          other.right -
          other.left +
          (other.bottom - other.top) -
          (one.right - one.left + (one.bottom - one.top)),
      );

      for (const leg of longestFirst) {
        if (leg.bottom - leg.top === 0 && leg.right - leg.left >= textWidth + 8) {
          for (const share of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
            const x = leg.left + (leg.right - leg.left) * share;

            if (x - textWidth / 2 >= leg.left + 2 && x + textWidth / 2 <= leg.right - 2) {
              candidates.push(
                { x, y: leg.top - 5, anchor: 'middle' },
                { x, y: leg.top + 17, anchor: 'middle' },
              );
            }
          }
        } else if (leg.right - leg.left === 0 && leg.bottom - leg.top >= 20) {
          for (const share of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const at = leg.top + (leg.bottom - leg.top) * share + 4;

            candidates.push(
              { x: leg.left + 8, y: at, anchor: 'start' },
              { x: leg.left - 8, y: at, anchor: 'end' },
            );
          }
        }
      }

      const rectOf = (candidate: TCandidate): IRect => {
        const left =
          candidate.anchor === 'middle'
            ? candidate.x - textWidth / 2
            : candidate.anchor === 'start'
              ? candidate.x
              : candidate.x - textWidth;

        return {
          left: left - 2,
          right: left + textWidth + 2,
          top: candidate.y - 13,
          bottom: candidate.y + 3,
        };
      };
      const usable = (candidate: TCandidate): boolean => {
        const rect = rectOf(candidate);
        const nearest = Math.min(...own.map((segment) => distanceTo({ rect, segment })));
        const rival = Math.min(
          ...others.map((segment) => distanceTo({ rect, segment })),
          Number.POSITIVE_INFINITY,
        );

        return (
          rect.left > 4 &&
          rect.right < width - 4 &&
          nearest <= LABEL_REACH &&
          rival > nearest + LABEL_MARGIN &&
          !others.some((segment) => touches(rect, grow(segment, 3))) &&
          !boxRects.some((box) => touches(rect, box)) &&
          !placedLabels.some((other) => touches(rect, other))
        );
      };
      const chosen = candidates.find(usable) ?? candidates[0];

      if (chosen === undefined) {
        return '';
      }

      placedLabels.push(rectOf(chosen));

      return `<text class="dl" x="${chosen.x}" y="${chosen.y}" text-anchor="${chosen.anchor}">${escaped(label)}</text>`;
    };
    const links = routes
      .map((route, index) => {
        const linePath = `M${route.points.map((point) => point.join(' ')).join('L')}`;
        const arrow = head({
          x: route.endX,
          y: route.endY,
          toward: route.plan.toSide === 'top' ? 'down' : 'up',
        });

        return `<g class="dlink"><path d="${linePath}" class="dline"/>${arrow}${labelOf(index)}</g>`;
      })
      .join('');
    const boxes = [...placed.values()]
      .map((box) => {
        const top = boxTop(box.row);
        const tone = box.spec.state === undefined ? undefined : NodeStates.toneOf(box.spec.state);
        const hasIcon = box.spec.state !== undefined;
        const textX = hasIcon ? box.x + 38 : box.centre;
        const anchor = hasIcon ? 'start' : 'middle';
        const first = top + (boxHeight - textHeight(box)) / 2;
        const titles = box.titleLines
          .map(
            (line, index) =>
              `<text class="t" x="${textX}" y="${first + 14 + index * TITLE_LINE}" text-anchor="${anchor}">${escaped(line)}</text>`,
          )
          .join('');
        const subs = box.subLines
          .map(
            (line, index) =>
              `<text class="s" x="${textX}" y="${first + box.titleLines.length * TITLE_LINE + 15 + index * SUB_LINE}" text-anchor="${anchor}">${escaped(line)}</text>`,
          )
          .join('');
        const icon = hasIcon
          ? `<g class="st" transform="translate(${box.x + 10} ${top + boxHeight / 2 - 10})">${SpecCharts.stateIcon({ state: box.spec.state ?? '', size: 20 }).replace('<svg', '<svg x="0" y="0"')}</g>`
          : '';

        return `<g class="dbox${tone === undefined ? '' : ` c-${tone}`}" data-box="${escaped(box.spec.id)}"><rect x="${box.x}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="4"/>${icon}${titles}${subs}</g>`;
      })
      .join('');
    const names = new Map(
      architecture.layers.flatMap((layer) =>
        layer.boxes.map((spec) => [spec.id, spec.label] as const),
      ),
    );
    // The state mark and the first word of a name stay together, so a break never leaves the mark behind.
    const nameOf = (spec: TBox): string => {
      if (spec.state === undefined) {
        return escaped(spec.label);
      }

      const [first = '', ...rest] = spec.label.split(' ');

      return `<span class="nb"><span class="c-${NodeStates.toneOf(spec.state)} inl">${SpecCharts.stateIcon({ state: spec.state, size: 16 })}</span>${escaped(first)}</span>${rest.length === 0 ? '' : ` ${escaped(rest.join(' '))}`}`;
    };
    const fallback = `<ul class="path">${architecture.layers.map((layer) => `<li><b>${escaped(layer.label)}:</b> <span>${layer.boxes.map(nameOf).join(', ')}</span></li>`).join('')}${architecture.links.map((link) => `<li>${escaped(names.get(link.from) ?? link.from)} <span class="verb">${escaped(link.label ?? opts.chrome.uses)}</span> ${escaped(names.get(link.to) ?? link.to)}</li>`).join('')}</ul>`;

    return {
      svg: `<svg width="${width}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escaped(opts.chrome.architecture)}">${bands}${links}${boxes}</svg>`,
      width,
      fallback,
    };
  }
}
