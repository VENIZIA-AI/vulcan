type TPoint = [number, number];

interface IShape {
  /** The silhouette of the body. */
  d: string;
  eyes: TPoint[];
  mouth: TPoint;
  cheeks: TPoint[];
}

const SHAPES: Record<string, IShape> = {
  bun: {
    d: 'M6 30C6 18.5 12.4 12 20 12s14 6.5 14 18c0 3.3-2.2 5-5 5H11c-2.8 0-5-1.7-5-5z',
    eyes: [
      [15, 23.4],
      [25, 23.4],
    ],
    mouth: [20, 28.4],
    cheeks: [
      [11.4, 27.2],
      [28.6, 27.2],
    ],
  },
  flame: {
    d: 'M20 4.5c2.2 5.2 6.4 7.6 9.6 12.2 2.6 3.7 3.9 7 3.9 10.3 0 5.6-5.6 9-13.5 9S6.5 32.6 6.5 27c0-4.2 2-7.6 4.6-10.4.6 2.4 1.8 3.8 3.4 4.4-.6-6.4 1.8-11.6 5.5-16.5z',
    eyes: [
      [15.2, 25.4],
      [24.8, 25.4],
    ],
    mouth: [20, 30],
    cheeks: [
      [11.4, 28.8],
      [28.6, 28.8],
    ],
  },
  ember: {
    d: 'M7.5 27.5c0-8 5.8-13.5 12.8-13.5S33 19.6 33 26.8c0 5.6-5 8.7-12.6 8.7S7.5 33 7.5 27.5z',
    eyes: [
      [15.4, 25.2],
      [25, 25.2],
    ],
    mouth: [20.2, 29.8],
    cheeks: [
      [11.6, 28.6],
      [28.8, 28.6],
    ],
  },
  rock: {
    d: 'M8.5 31.5 6.8 23.6l4.4-8.2 8-4.2 9.2 2.2 5 7.2v8.6l-4.8 6.3H13.2z',
    eyes: [
      [15, 24.6],
      [24.6, 24.6],
    ],
    mouth: [19.8, 29.4],
    cheeks: [
      [11, 28.2],
      [28.4, 28.2],
    ],
  },
  banana: {
    d: 'M5.6 18.6c-.9-2 1.6-3.6 3.2-2.2 3.4 3.2 7.2 4.6 11.2 4.6s7.8-1.4 11.2-4.6c1.6-1.4 4.1.2 3.2 2.2-3 8.4-8.6 14.4-14.4 14.4S8.6 27 5.6 18.6z',
    eyes: [
      [15.4, 25.6],
      [24.6, 25.6],
    ],
    mouth: [20, 29.4],
    cheeks: [
      [11.8, 27.6],
      [28.2, 27.6],
    ],
  },
};

/** One solid colour per agent, from a fixed palette: yellow, red, green, blue, purple, pink. */
const COLORS = ['#F5B83D', '#EF5B3A', '#8FD16F', '#5BB6E8', '#B28DE0', '#F28DB2'];
const SLEEP_COLOR = '#8E8FA3';
const CHEEK = '#FF8A80';

export type TFaceState = 'working' | 'you' | 'idle' | 'blocked';

const Eyes = (props: { shape: IShape; state: TFaceState }) => {
  const { state } = props;

  return (
    <g className={state === 'working' ? 'm-squint' : undefined}>
      {props.shape.eyes.map(([x, y], index) => {
        const inner = index === 0 ? 1 : -1;

        if (state === 'idle') {
          return <path key={x} d={`M${x - 2.4} ${y}q2.4 1.8 4.8 0`} className="m-o m-line" />;
        }

        return (
          <g key={x}>
            <circle cx={x} cy={y} r={2.3} className="m-ink" />
            <circle cx={x + 0.8} cy={y - 0.8} r={0.8} fill="#fff" />
            {state === 'you' ? (
              <path d={`M${x - 2.6 * inner} ${y - 4.2}l${4 * inner} -1`} className="m-o m-line" />
            ) : null}
            {state === 'blocked' ? (
              <path d={`M${x - 2.2 * inner} ${y - 3.2}l${4 * inner} -1.4`} className="m-o m-line" />
            ) : null}
          </g>
        );
      })}
    </g>
  );
};

const Mouth = (props: { at: TPoint; state: TFaceState }) => {
  const [x, y] = props.at;

  if (props.state === 'working') {
    return <path d={`M${x - 2.2} ${y - 0.4}q2.2 1.4 4.4 0`} className="m-o m-line" />;
  }

  if (props.state === 'you') {
    return <ellipse cx={x} cy={y + 0.2} rx={1.8} ry={1.4} className="m-ink" />;
  }

  if (props.state === 'blocked') {
    return <path d={`M${x - 2.8} ${y + 0.8}q1.4-1.5 2.8 0t2.8 0`} className="m-o m-line m-bad" />;
  }

  return <ellipse cx={x} cy={y + 0.2} rx={1.4} ry={1} className="m-ink" />;
};

const Body = (props: { shape: IShape; state: TFaceState; fill: string }) => (
  <>
    <path d={props.shape.d} fill={props.fill} className="m-o" strokeWidth={2.2} />
    <Eyes shape={props.shape} state={props.state} />
    {props.shape.cheeks.map(([x, y]) => (
      <ellipse key={x} cx={x} cy={y} rx={2.4} ry={1.5} fill={CHEEK} />
    ))}
    <Mouth at={props.shape.mouth} state={props.state} />
  </>
);

/** The hoe and the two hands that hold it: it swings over the head and strikes the soil. */
const Hoe = (props: { fill: string }) => (
  <g transform="translate(8,3)">
    <g className="m-hoe">
      <path d="M22.5 18.5 41 37" strokeWidth={4.2} className="m-o m-line" />
      <path d="M22.5 18.5 41 37" stroke="#B9783F" strokeWidth={2.2} strokeLinecap="round" />
      <path
        d="M38.6 34.6 44.4 33.2 45.6 40.2 41.2 41.6z"
        fill="#A9B4BF"
        className="m-o"
        strokeWidth={1.6}
      />
      <circle cx={25} cy={21} r={2.6} fill={props.fill} className="m-o" strokeWidth={1.6} />
      <circle cx={29.4} cy={25.4} r={2.6} fill={props.fill} className="m-o" strokeWidth={1.6} />
    </g>
  </g>
);

export class BoardFace {
  /** The shape an agent has: the one the config names, else the default. */
  static shapeOf(opts: { name: string; shapes: Record<string, string> }): string {
    const named = opts.shapes[opts.name];

    return named in SHAPES ? named : 'bun';
  }

  /** A solid colour from the fixed palette, chosen by a hash of the name: the same agent has the same colour everywhere. */
  static colorOf(opts: { name: string }): string {
    let hash = 0;

    for (const char of opts.name) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return COLORS[hash % COLORS.length];
  }
}

/**
 * An agent's mascot: its shape in one solid colour with a thick outline, round hands and pink cheeks.
 * Working, it digs with a hoe over a mound of soil; waiting on the owner, it waves under a yellow "?";
 * asleep, it is grey with closed eyes; stuck, it sweats. The motion is CSS and stops for reduced motion.
 */
export const Mascot = (props: { state: TFaceState; name: string; shape: string }) => {
  const shape = SHAPES[props.shape];
  const color = BoardFace.colorOf({ name: props.name });

  return (
    <svg viewBox="-6 -16 68 60" className="bot" aria-hidden="true">
      {props.state === 'working' ? (
        <>
          <ellipse
            cx={47}
            cy={40.5}
            rx={10}
            ry={3}
            fill="#8B5A2B"
            className="m-o"
            strokeWidth={1.6}
          />
          <path d="M39 40.5c3-4 13-4 16 0" fill="#A0703F" className="m-o" strokeWidth={1.6} />
          <g className="m-dig">
            <Body shape={shape} state="working" fill={color} />
          </g>
          <Hoe fill={color} />
          <circle cx={50} cy={39} r={1.6} fill="#8B5A2B" className="m-o m-clod" strokeWidth={0.8} />
          <circle
            cx={51}
            cy={39.5}
            r={1.2}
            fill="#8B5A2B"
            className="m-o m-clod m-c2"
            strokeWidth={0.8}
          />
          <circle
            cx={48.5}
            cy={39}
            r={1.1}
            fill="#8B5A2B"
            className="m-o m-clod m-c3"
            strokeWidth={0.8}
          />
        </>
      ) : null}
      {props.state === 'idle' ? (
        <>
          <ellipse cx={20} cy={36.8} rx={14} ry={1.8} className="m-ink m-shadow" />
          <g className="m-sleep">
            <Body shape={shape} state="idle" fill={SLEEP_COLOR} />
            <circle
              cx={24.5}
              cy={29}
              r={2.6}
              fill="#BFE6FF"
              className="m-o m-snot"
              strokeWidth={0.9}
            />
          </g>
          <text x={31} y={10} className="m-zz">
            z
          </text>
          <text x={31} y={10} className="m-zz m-z2">
            z
          </text>
          <text x={31} y={10} className="m-zz m-z3">
            Z
          </text>
        </>
      ) : null}
      {props.state === 'you' ? (
        <>
          <g className="m-bubble">
            <path
              d="M26 -10h18a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-9l-5 4 1-4h-5a4 4 0 0 1-4-4v-10a4 4 0 0 1 4-4z"
              fill="#F6D33C"
              className="m-o"
              strokeWidth={1.8}
            />
            <text x={35} y={5} textAnchor="middle" className="m-q">
              ?
            </text>
          </g>
          <g className="m-lean">
            <Body shape={shape} state="you" fill={color} />
            <g className="m-wave">
              <circle cx={35.4} cy={22} r={2.7} fill={color} className="m-o" strokeWidth={1.6} />
            </g>
          </g>
        </>
      ) : null}
      {props.state === 'blocked' ? (
        <>
          <Body shape={shape} state="blocked" fill={color} />
          <path
            d="M7.6 13.4c1.3 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .7-2 2-3.8z"
            fill="#BFE6FF"
            className="m-o"
            strokeWidth={0.9}
          />
          <circle cx={34} cy={7.4} r={3.4} fill="var(--fail)" className="m-o" strokeWidth={1.2} />
          <path d="M34 5.6v2.2" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
          <circle cx={34} cy={9.3} r={0.5} fill="#fff" />
        </>
      ) : null}
    </svg>
  );
};
