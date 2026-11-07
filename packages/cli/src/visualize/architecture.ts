import { SpecCharts } from './charts.ts';
import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import type { IDrawing } from './diagrams.ts';
import { FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

type TArchitecture = NonNullable<TVisualizeSpec['architecture']>;
type TBox = TArchitecture['layers'][number]['boxes'][number];
type TLink = TArchitecture['links'][number];

const PAD = 24;
const GAP = 48;
const MIN_BOX_WIDTH = 128;
const MAX_BOX_WIDTH = 192;
/** The widest the drawing is made: the content column, less its frame, holds it at 92% (see the fit rule of the page). */
const TARGET_WIDTH = 1270;
const TOP_ZONE = 32;
const BOTTOM_PAD = 14;
const LANE = 20;
const CHANNEL_BASE = 18;
const TITLE_SIZE = 14;
const SUB_SIZE = 12.5;
const LABEL_SIZE = 12.5;
const TITLE_LINE = 18;
const SUB_LINE = 15;

const escaped = (value: string): string => FigureLayout.escapeText({ value });

interface IPlacedBox {
  spec: TBox;
  row: number;
  /** The left edge and the middle, in pixels. */
  x: number;
  centre: number;
  titleLines: string[];
  subLines: string[];
}

type TSide = 'top' | 'bottom';

interface IStep {
  channel: number;
  lane: number;
}

interface IPlannedLink {
  link: TLink;
  from: IPlacedBox;
  to: IPlacedBox;
  /** The edge each end meets: leaving a box and entering one. */
  fromSide: TSide;
  toSide: TSide;
  first: IStep;
  /** A link over more than one layer goes down the right margin: its second horizontal run and the lane of the margin. */
  second?: IStep;
  margin?: number;
}

/**
 * The layered view: bands from top to bottom, boxes in each, and an orthogonal line for every link that never crosses
 * a box. Between two bands is a channel; a link runs along its own lane of a channel, so no two lines share one, and
 * a link over more than one layer goes down the right margin, which no box reaches. The boxes are as wide as the
 * widest layer lets the drawing stay under TARGET_WIDTH, and their text wraps inside them.
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
    const margin = farCount === 0 ? 0 : 16 + 12 * farCount;
    const boxWidth = Math.min(
      MAX_BOX_WIDTH,
      Math.max(
        MIN_BOX_WIDTH,
        Math.floor((TARGET_WIDTH - 2 * PAD - margin - (most - 1) * GAP) / most),
      ),
    );
    const width = 2 * PAD + margin + most * boxWidth + (most - 1) * GAP;
    const textWidthOf = (spec: TBox): number => boxWidth - (spec.state === undefined ? 24 : 50);
    const placed = new Map<string, IPlacedBox>();

    architecture.layers.forEach((layer, row) => {
      const total = layer.boxes.length * boxWidth + (layer.boxes.length - 1) * GAP;
      const start = PAD + (width - 2 * PAD - margin - total) / 2;

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
    const slots = new Map<string, number>();
    let marginLane = 0;
    const plans: IPlannedLink[] = known.map((link) => {
      const from = placed.get(link.from) as IPlacedBox;
      const to = placed.get(link.to) as IPlacedBox;
      const down = to.row >= from.row;
      const isSame = to.row === from.row;
      // A link between two boxes of one layer leaves and enters by the bottom edges, along the channel below the row.
      const fromSide: TSide = isSame || down ? 'bottom' : 'top';
      const toSide: TSide = isSame ? 'bottom' : down ? 'top' : 'bottom';
      const span = Math.abs(to.row - from.row);

      if (span <= 1) {
        const channel = isSame ? from.row : Math.min(from.row, to.row);

        return { link, from, to, fromSide, toSide, first: take(channel) };
      }

      marginLane += 1;

      return {
        link,
        from,
        to,
        fromSide,
        toSide,
        first: take(down ? from.row : from.row - 1),
        second: take(down ? to.row - 1 : to.row),
        margin: width - PAD - margin + 12 * marginLane - 6,
      };
    });
    const slotOf = (end: { id: string; side: TSide }): number => {
      const key = `${end.id}:${end.side}`;
      const slot = slots.get(key) ?? 0;

      slots.set(key, slot + 1);

      return slot;
    };
    const totals = new Map<string, number>();

    for (const plan of plans) {
      for (const [id, side] of [
        [plan.from.spec.id, plan.fromSide],
        [plan.to.spec.id, plan.toSide],
      ] as const) {
        totals.set(`${id}:${side}`, (totals.get(`${id}:${side}`) ?? 0) + 1);
      }
    }

    const offsetOf = (end: { id: string; side: TSide }): number => {
      const count = totals.get(`${end.id}:${end.side}`) ?? 1;
      const slot = slotOf(end);

      return (slot - (count - 1) / 2) * 14;
    };

    // The geometry of bands and channels, from the lanes the links need.
    const rows = architecture.layers.length;
    const bandHeight = TOP_ZONE + boxHeight + BOTTOM_PAD;
    const channelHeight = (channel: number): number =>
      channel === rows - 1 && (lanes.get(channel) ?? 0) === 0
        ? 6
        : CHANNEL_BASE + LANE * (lanes.get(channel) ?? 0);
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
      (channelTops[step.channel] ?? 0) + 10 + LANE * step.lane + 6;
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
    const routes = plans.map((plan) => {
      const startX = plan.from.centre + offsetOf({ id: plan.from.spec.id, side: plan.fromSide });
      const endX = plan.to.centre + offsetOf({ id: plan.to.spec.id, side: plan.toSide });
      const startY = plan.fromSide === 'bottom' ? boxBottom(plan.from.row) : boxTop(plan.from.row);
      const endY = plan.toSide === 'bottom' ? boxBottom(plan.to.row) : boxTop(plan.to.row);
      const first = laneY(plan.first);
      const points: [number, number][] =
        plan.second === undefined || plan.margin === undefined
          ? [
              [startX, startY],
              [startX, first],
              [endX, first],
              [endX, endY],
            ]
          : [
              [startX, startY],
              [startX, first],
              [plan.margin, first],
              [plan.margin, laneY(plan.second)],
              [endX, laneY(plan.second)],
              [endX, endY],
            ];

      return { plan, points, startX, endX, endY, first, runEnd: plan.margin ?? endX };
    });
    interface IRect {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }
    const touches = (one: IRect, other: IRect): boolean =>
      one.left < other.right &&
      one.right > other.left &&
      one.top < other.bottom &&
      one.bottom > other.top;
    const legsOf = (index: number): IRect[] =>
      routes.flatMap((route, at) =>
        at === index
          ? []
          : route.points.slice(1).map((point, leg) => {
              const before = route.points[leg] ?? point;

              return {
                left: Math.min(before[0], point[0]) - 3,
                right: Math.max(before[0], point[0]) + 3,
                top: Math.min(before[1], point[1]) - 3,
                bottom: Math.max(before[1], point[1]) + 3,
              };
            }),
      );
    const boxRects: IRect[] = [...placed.values()].map((box) => ({
      left: box.x - 3,
      right: box.x + boxWidth + 3,
      top: boxTop(box.row) - 3,
      bottom: boxBottom(box.row) + 3,
    }));
    const placedLabels: IRect[] = [];
    const labelOf = (index: number): string => {
      const route = routes[index];
      const label = route?.plan.link.label;

      if (route === undefined || label === undefined) {
        return '';
      }

      const textWidth = FigureLayout.textWidth({ text: label, size: LABEL_SIZE });
      const low = Math.min(route.startX, route.runEnd);
      const high = Math.max(route.startX, route.runEnd);
      const avoid = [...legsOf(index), ...boxRects, ...placedLabels];
      // Above the line, along the run; then beside the line, past either end.
      const candidates: { x: number; y: number; anchor: 'middle' | 'start' | 'end' }[] = [
        ...[0.5, 0.3, 0.7, 0.15, 0.85]
          .filter(() => high - low >= textWidth + 12)
          .map((share) => ({
            x: low + (high - low) * share,
            y: route.first - 6,
            anchor: 'middle' as const,
          })),
        { x: high + 10, y: route.first + 4, anchor: 'start' },
        { x: low - 10, y: route.first + 4, anchor: 'end' },
        { x: high + 10, y: route.first - 6, anchor: 'start' },
      ];
      const fits = (candidate: (typeof candidates)[number]): { rect: IRect; ok: boolean } => {
        const left =
          candidate.anchor === 'middle'
            ? candidate.x - textWidth / 2
            : candidate.anchor === 'start'
              ? candidate.x
              : candidate.x - textWidth;
        const rect = {
          left: left - 2,
          right: left + textWidth + 2,
          top: candidate.y - 12,
          bottom: candidate.y + 4,
        };

        return {
          rect,
          ok:
            left > 4 &&
            left + textWidth < width - 4 &&
            !avoid.some((other) => touches(rect, other)),
        };
      };
      const chosen = candidates.find((candidate) => fits(candidate).ok) ?? candidates[0];

      if (chosen === undefined) {
        return '';
      }

      placedLabels.push(fits(chosen).rect);

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
        const left = box.x;
        const textX = hasIcon ? left + 38 : box.centre;
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
          ? `<g class="st" transform="translate(${left + 10} ${top + boxHeight / 2 - 10})">${SpecCharts.stateIcon({ state: box.spec.state ?? '', size: 20 }).replace('<svg', '<svg x="0" y="0"')}</g>`
          : '';

        return `<g class="dbox${tone === undefined ? '' : ` c-${tone}`}" data-box="${escaped(box.spec.id)}"><rect x="${left}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="4"/>${icon}${titles}${subs}</g>`;
      })
      .join('');
    const names = new Map(
      architecture.layers.flatMap((layer) =>
        layer.boxes.map((spec) => [spec.id, spec.label] as const),
      ),
    );
    const fallback = `<ul class="path">${architecture.layers.map((layer) => `<li><b>${escaped(layer.label)}:</b> ${layer.boxes.map((spec) => `${spec.state === undefined ? '' : `<span class="c-${NodeStates.toneOf(spec.state)} inl">${SpecCharts.stateIcon({ state: spec.state, size: 16 })}</span>`}${escaped(spec.label)}`).join(', ')}</li>`).join('')}${architecture.links.map((link) => `<li>${escaped(names.get(link.from) ?? link.from)} <span class="verb">${escaped(link.label ?? opts.chrome.uses)}</span> ${escaped(names.get(link.to) ?? link.to)}</li>`).join('')}</ul>`;

    return {
      svg: `<svg width="${width}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escaped(opts.chrome.architecture)}">${bands}${links}${boxes}</svg>`,
      width,
      fallback,
    };
  }
}
