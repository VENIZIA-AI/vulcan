import type { ReactNode } from 'react';

type TPoint = [number, number];

interface IShape {
  /** The body, and the shade on its far side. */
  d: string;
  shade: string | null;
  /** Only the person has a head of its own, drawn over the body. */
  head?: { cx: number; cy: number; r: number };
  eyes: TPoint[];
  mouth: TPoint;
  cheeks: TPoint[];
  /** Where a raised hand and the headband go. */
  hand: TPoint;
  band: string | null;
  knot: TPoint | null;
  /** What this shape has that no other has: an antenna, a crack, a stem. */
  detail: ReactNode;
}

const star = (opts: { x: number; y: number; r: number }): string => {
  const { x, y, r } = opts;
  const q = r * 0.32;

  return `M${x} ${y - r}Q${x + q} ${y - q} ${x + r} ${y}Q${x + q} ${y + q} ${x} ${y + r}Q${x - q} ${y + q} ${x - r} ${y}Q${x - q} ${y - q} ${x} ${y - r}z`;
};

const SHAPES: Record<string, IShape> = {
  bun: {
    d: 'M6 30C6 18.5 12.4 12 20 12s14 6.5 14 18c0 3.3-2.2 5-5 5H11c-2.8 0-5-1.7-5-5z',
    shade: 'M25.6 13.6c5 2.4 8.4 8 8.4 16.4 0 3.3-2.2 5-5 5h-5.6c4.6-2 7-9.4 2.2-21.4z',
    eyes: [
      [15, 23.4],
      [25, 23.4],
    ],
    mouth: [20, 28.4],
    cheeks: [
      [11.4, 27.2],
      [28.6, 27.2],
    ],
    hand: [33.4, 24],
    band: 'M8.2 19.6q11.8-4.6 23.6 0',
    knot: [31.8, 19.6],
    detail: (
      <g className="ant">
        <path d={star({ x: 20, y: 6.4, r: 3.6 })} className="acc" />
        <path d={star({ x: 26.6, y: 8.6, r: 1.6 })} className="acc" />
      </g>
    ),
  },
  flame: {
    d: 'M20 4.5c2.2 5.2 6.4 7.6 9.6 12.2 2.6 3.7 3.9 7 3.9 10.3 0 5.6-5.6 9-13.5 9S6.5 32.6 6.5 27c0-4.2 2-7.6 4.6-10.4.6 2.4 1.8 3.8 3.4 4.4-.6-6.4 1.8-11.6 5.5-16.5z',
    shade: 'M27.6 15.4c3.8 4.2 5.9 7.8 5.9 11.6 0 5-4.4 8.4-10.8 8.9 4.6-2.4 7.8-9.4 4.9-20.5z',
    eyes: [
      [15.2, 25.4],
      [24.8, 25.4],
    ],
    mouth: [20, 30],
    cheeks: [
      [11.4, 28.8],
      [28.6, 28.8],
    ],
    hand: [33, 26],
    band: 'M9.6 21.2q10.4-4.2 20.8 0',
    knot: [30.4, 21.2],
    detail: (
      <path
        d="M20 9.6c1 2.2 2.6 3.4 2.6 5.4a2.6 2.6 0 0 1-5.2 0c0-2 1.6-3.2 2.6-5.4z"
        className="core"
      />
    ),
  },
  ember: {
    d: 'M7.5 27.5c0-8 5.8-13.5 12.8-13.5S33 19.6 33 26.8c0 5.6-5 8.7-12.6 8.7S7.5 33 7.5 27.5z',
    shade: 'M25.4 15c4.6 1.8 7.6 6 7.6 11.8 0 5.2-4.4 8.2-11 8.6 5-2.6 7.6-10.4 3.4-20.4z',
    eyes: [
      [15.4, 25.2],
      [25, 25.2],
    ],
    mouth: [20.2, 29.8],
    cheeks: [
      [11.6, 28.6],
      [28.8, 28.6],
    ],
    hand: [32.6, 25],
    band: 'M9.2 21.6q11.2-4.4 22.4 0',
    knot: [31.6, 21.6],
    detail: (
      <>
        <g className="ant">
          <path d="M13.6 10.8l-1.4-2.6M20.4 9.6V6.6M27.2 10.8l1.4-2.6" className="acc-stroke" />
        </g>
        <circle cx={11.8} cy={31.4} r={0.9} className="speck" />
        <circle cx={27.6} cy={32.2} r={0.8} className="speck" />
      </>
    ),
  },
  rock: {
    d: 'M8.5 31.5 6.8 23.6l4.4-8.2 8-4.2 9.2 2.2 5 7.2v8.6l-4.8 6.3H13.2z',
    shade: 'M28.4 13.4l5 7.2v8.6l-4.8 6.3h-5.4l5-6.8-.6-9.4z',
    eyes: [
      [15, 24.6],
      [24.6, 24.6],
    ],
    mouth: [19.8, 29.4],
    cheeks: [
      [11, 28.2],
      [28.4, 28.2],
    ],
    hand: [33.4, 25],
    band: 'M8.4 20.8q10.8-4.4 22.4-.4',
    knot: [30.8, 20.4],
    detail: (
      <>
        <path d="M28.2 13.8l-1.9 3.4 1.8 1.8-1.4 2.6" className="acc-stroke crack" />
        <path d="M11.4 15.6l3 5" className="facet" />
      </>
    ),
  },
  banana: {
    d: 'M5.6 18.6c-.9-2 1.6-3.6 3.2-2.2 3.4 3.2 7.2 4.6 11.2 4.6s7.8-1.4 11.2-4.6c1.6-1.4 4.1.2 3.2 2.2-3 8.4-8.6 14.4-14.4 14.4S8.6 27 5.6 18.6z',
    shade:
      'M28.6 23.4c1.4-1.4 2.6-3.2 3.6-5.2 1.2-.6 2.4-.4 2.6.4-2.6 7.4-7.4 12.8-12.6 14.2 2.8-2 4.8-5.6 6.4-9.4z',
    eyes: [
      [15.4, 25.6],
      [24.6, 25.6],
    ],
    mouth: [20, 29.4],
    cheeks: [
      [11.8, 27.6],
      [28.2, 27.6],
    ],
    hand: [33.2, 20.6],
    band: null,
    knot: null,
    detail: (
      <>
        <g className="ant">
          <path d="M33 16.8q.6-2.6 2.4-4" className="stem" />
        </g>
        <circle cx={6.4} cy={17.8} r={1} className="tip" />
      </>
    ),
  },
  person: {
    d: 'M7 36c0-7 5.8-11.4 13-11.4S33 29 33 36z',
    head: { cx: 20, cy: 15.4, r: 7.6 },
    shade: null,
    eyes: [
      [17, 15.4],
      [23, 15.4],
    ],
    mouth: [20, 19],
    cheeks: [
      [14.6, 18.2],
      [25.4, 18.2],
    ],
    hand: [31, 28],
    band: null,
    knot: null,
    detail: null,
  },
};

export type TFaceState = 'working' | 'you' | 'idle' | 'blocked';

const Eyes = (props: { shape: IShape; state: TFaceState }) => (
  <g className="eyes">
    {props.shape.eyes.map(([x, y], index) => {
      if (props.state === 'idle') {
        return <path key={x} d={`M${x - 2} ${y}q2 1.7 4 0`} className="stroke" />;
      }

      if (props.state === 'working') {
        return (
          <g key={x}>
            <ellipse cx={x} cy={y} rx={2.1} ry={1.65} className="ink" />
            <circle cx={x + 0.7} cy={y - 0.6} r={0.6} className="glint" />
          </g>
        );
      }

      const eyeY = props.state === 'you' ? y - 0.4 : y;
      const inner = index === 0 ? 1 : -1;

      return (
        <g key={x}>
          <circle cx={x} cy={eyeY} r={2.3} className="ink" />
          <circle
            cx={x + 0.7}
            cy={props.state === 'you' ? eyeY - 1.3 : eyeY - 0.8}
            r={0.75}
            className="glint"
          />
          {props.state === 'blocked' ? (
            <path
              d={`M${x - 2.2 * inner} ${y - 3.2}L${x + 1.8 * inner} ${y - 4.6}`}
              className="stroke brow"
            />
          ) : null}
        </g>
      );
    })}
  </g>
);

const Mouth = (props: { at: TPoint; state: TFaceState }) => {
  const [x, y] = props.at;

  if (props.state === 'working') {
    return <path d={`M${x - 1.8} ${y}q1.8 1.5 3.6 0`} className="stroke" />;
  }

  if (props.state === 'you') {
    return <ellipse cx={x} cy={y + 0.3} rx={1.3} ry={1.5} className="ink" />;
  }

  if (props.state === 'blocked') {
    return <path d={`M${x - 2.8} ${y + 0.8}q1.4-1.5 2.8 0t2.8 0`} className="stroke mouth-bad" />;
  }

  return <path d={`M${x - 1.4} ${y}h2.8`} className="stroke" />;
};

/** The state's own marks around the body: sparks at work, a raised hand and a badge when it waits, zzz asleep, a drop and a mark when stuck. */
const Marks = (props: { shape: IShape; state: TFaceState; tint: string }) => {
  const [hx, hy] = props.shape.hand;

  if (props.state === 'working') {
    return (
      <>
        <path d={star({ x: 33.4, y: 9.4, r: 2.2 })} className="spark" />
        <path d={star({ x: 36.6, y: 15, r: 1.4 })} className="spark" />
      </>
    );
  }

  if (props.state === 'you') {
    return (
      <>
        <g className="hand">
          <rect
            x={hx - 1.9}
            y={hy - 9.4}
            width={3.8}
            height={6.8}
            rx={1.9}
            transform={`rotate(24 ${hx} ${hy - 2.6})`}
            fill={`var(${props.tint})`}
            className="shell"
          />
        </g>
        <g className="badge-g">
          <circle cx={7} cy={7.4} r={5} className="badge" />
          <text x={7} y={9.9} textAnchor="middle" className="badge-ink">
            !
          </text>
        </g>
      </>
    );
  }

  if (props.state === 'idle') {
    return (
      <>
        <text x={31.6} y={9.6} className="z">
          z
        </text>
        <text x={35.4} y={5.4} className="z z2">
          z
        </text>
      </>
    );
  }

  return (
    <>
      <path d="M7.6 13.4c1.3 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .7-2 2-3.8z" className="sweat" />
      <circle cx={34} cy={7.4} r={3.2} className="mark" />
      <path d="M34 5.6v2.2" className="mark-ink" />
      <circle cx={34} cy={9.3} r={0.45} className="mark-dot" />
    </>
  );
};

/** An agent's face: its shape, tinted by a hash of its name, with the eyes, mouth and marks of the state it is in. */
export const Face = (props: {
  state: TFaceState;
  tint: string;
  name: string;
  shape: string;
  size?: { x: number; y: number; width: number; height: number };
}) => {
  const shape = SHAPES[props.shape];
  const [kx, ky] = shape.knot ?? [0, 0];

  return (
    <svg viewBox="0 0 40 40" className="bot" aria-hidden="true" {...props.size}>
      <g className="body">
        <path
          d={shape.d}
          fill={shape.head ? 'var(--t-other)' : `var(${props.tint})`}
          className="shell"
        />
        {shape.head ? <circle {...shape.head} fill="var(--t-other)" className="shell" /> : null}
        {!shape.head && shape.shade ? <path d={shape.shade} className="shade" /> : null}
        {shape.detail}
        {/^pnt-/.test(props.name) && shape.band ? (
          <>
            <path d={shape.band} className="band" />
            <path d={`M${kx} ${ky}l2.4-1.8M${kx} ${ky}l2.6.9`} className="band" />
          </>
        ) : null}
        <Eyes shape={shape} state={props.state} />
        {props.state === 'blocked'
          ? null
          : shape.cheeks.map(([x, y]) => (
              <ellipse key={x} cx={x} cy={y} rx={1.7} ry={1.1} className="cheek" />
            ))}
        <Mouth at={shape.mouth} state={props.state} />
      </g>
      <Marks shape={shape} state={props.state} tint={props.tint} />
    </svg>
  );
};

export class BoardFace {
  /** The shape an agent has: the one the config names, else the default; the owner is a person. */
  static shapeOf(opts: { name: string; owner: string; shapes: Record<string, string> }): string {
    if (opts.name === opts.owner) {
      return 'person';
    }

    const named = opts.shapes[opts.name];

    return named in SHAPES ? named : 'bun';
  }

  /** A tint from a fixed neutral palette, chosen by a hash of the name: the same agent has the same colour everywhere. */
  static tintOf(opts: { name: string }): string {
    let hash = 0;

    for (const char of opts.name) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return `--t-p${hash % 5}`;
  }
}
