import { useRef, useState } from 'react';
import { BoardStateWords } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView } from '../common/types.ts';
import { useSize } from '../hooks.ts';
import { useUi } from '../i18n/context.ts';
import { BoardGraph } from '../state/graph.ts';
import type { IPair } from '../state/graph.ts';
import { EventItem } from './bits.tsx';
import { BoardFace, Face } from './face.tsx';
import type { TFaceState } from './face.tsx';

const ACTIVE_MS = 30 * 60_000;
const ENTER_OR_SPACE = new Set(['Enter', ' ']);

export interface IAgentsProps {
  rows: IAgentRow[];
  views: IFlowView[];
  events: IBoardViewEvent[];
  owner: string;
  shapes: Record<string, string>;
  popFor: string | null;
  onNode: (name: string, anchor: Element) => void;
  onFlow: (id: string) => void;
  /** Whether the tab is showing: the graph is measured when it is. */
  shown: boolean;
}

/** Enter or Space does what a click does. */
const keyed = (action: () => void) => (event: { key: string; preventDefault: () => void }) => {
  if (ENTER_OR_SPACE.has(event.key)) {
    event.preventDefault();
    action();
  }
};

const Side = (props: { pair: IPair | undefined; onFlow: (id: string) => void }) => {
  const { t } = useUi();
  const { pair } = props;

  if (pair === undefined) {
    return <p className="empty">{t('gr.hint')}</p>;
  }

  const flows = [...new Set(pair.evs.map((event) => event.flowId).filter(Boolean))];

  return (
    <>
      <div className="dh">
        <div className="meta">{`${t('gr.flows')}: ${flows.length}`}</div>
        <div className="dacts">
          {flows.map((id) => (
            <button key={id} className="btn chip" type="button" onClick={() => props.onFlow(id)}>
              {id}
            </button>
          ))}
        </div>
      </div>
      <ul className="evs" style={{ padding: '8px 16px 16px' }}>
        {BoardGraph.newestFirst({ pair }).map((event) => (
          <EventItem key={event.id} event={event} />
        ))}
      </ul>
    </>
  );
};

/** The Agent tab: the agents as a ring around the owner, a line between two that talked, and what passed along a line picked. */
export const AgentsView = (props: IAgentsProps) => {
  const { t, now } = useUi();
  const wrap = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const size = useSize({ ref: wrap });
  const width = Math.max(320, size.width);
  const height = Math.max(260, size.height);
  const names = [props.owner, ...props.rows.map((row) => row.n)];
  const states: Record<string, TFaceState> = Object.fromEntries(
    props.rows.map((row) => [row.n, row.st]),
  );
  const positions = BoardGraph.positions({
    owner: props.owner,
    agents: props.rows.map((row) => row.n),
    width,
    height,
  });
  const pairs = BoardGraph.pairsOf({
    names: new Set(names),
    owner: props.owner,
    events: props.events,
    flows: props.views,
  });
  const pair = picked === null ? undefined : pairs[picked];

  states[props.owner] = props.views.some((view) => view.flow.state === 'you') ? 'you' : 'idle';

  return (
    <>
      <section className="pane graphp" aria-label={t('Agent graph')}>
        <div className="ph">
          <h2>
            <span>{t('gr.title')}</span>
          </h2>
          <span className="n" id="agN">{`${props.rows.length} ${t('n.agents')}`}</span>
          <span className="spacer" />
          <span className="glegend" id="gLegend">
            <span>
              <i className="a" />
              {t('gr.active')}
            </span>
          </span>
        </div>
        <div ref={wrap} className="pb gwrap" id="gWrap">
          <svg
            id="graph"
            className="graph"
            role="group"
            aria-label="graph"
            viewBox={`0 0 ${width} ${height}`}
          >
            <g className="edges">
              {Object.entries(pairs).map(([key, one]) => {
                const edge = BoardGraph.edgeOf({ from: positions[one.a], to: positions[one.b] });
                const open = (): void => setPicked(key);

                return (
                  <g key={key} data-k={key}>
                    <path
                      className={`edge${now - Date.parse(one.last) < ACTIVE_MS ? ' active' : ''}${picked === key ? ' sel' : ''}`}
                      d={edge.d}
                      strokeWidth={Math.min(7, 1.2 + Math.log2(one.evs.length + 1) * 1.3)}
                    />
                    <path
                      className="ehit"
                      d={edge.d}
                      tabIndex={0}
                      role="button"
                      aria-label={`${one.a} ↔ ${one.b}, ${one.evs.length} ${t('gr.events')}`}
                      onClick={open}
                      onKeyDown={keyed(open)}
                    />
                    <text
                      className="ecount"
                      textAnchor="middle"
                      x={edge.label[0].toFixed(1)}
                      y={edge.label[1].toFixed(1)}
                    >
                      {one.evs.length}
                    </text>
                  </g>
                );
              })}
            </g>
            <g className="nodes">
              {names.map((name) => {
                const state = states[name] ?? 'idle';
                const owner = name === props.owner;
                const act = (anchor: Element): void => {
                  if (!owner) {
                    props.onNode(name, anchor);
                  }
                };
                const [x, y] = positions[name];
                const word = owner ? '' : t(BoardStateWords.PILL[state]);
                const said = owner && state === 'you' ? t('Chờ anh') : word;

                return (
                  <g
                    key={name}
                    data-n={name}
                    data-st={state}
                    className={`node ${state}${owner ? ' me' : ''}${props.popFor === name ? ' sel' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${name}, ${word}`}
                    style={{ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)` }}
                    onClick={(event) => act(event.currentTarget)}
                    onKeyDown={(event) => keyed(() => act(event.currentTarget))(event)}
                  >
                    {state === 'working' ? <circle r={30} className="pulse" /> : null}
                    <circle r={30} className="ring" />
                    {owner ? (
                      <text
                        textAnchor="middle"
                        y={5}
                        fill="var(--bg)"
                        style={{ font: '700 15px var(--font)' }}
                      >
                        P
                      </text>
                    ) : (
                      <Face
                        state={state}
                        tint={BoardFace.tintOf({ name })}
                        name={name}
                        shape={BoardFace.shapeOf({
                          name,
                          owner: props.owner,
                          shapes: props.shapes,
                        })}
                        size={{ x: -20, y: -21, width: 40, height: 40 }}
                      />
                    )}
                    <text className="gname" textAnchor="middle" y={48}>
                      {name}
                    </text>
                    <text className="gst" textAnchor="middle" y={63}>
                      {said}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </section>
      <section className="pane gside" aria-label={t('Pair')}>
        <div className="ph">
          <h2 id="gSideT">
            <span>
              {pair ? `${pair.a} ↔ ${pair.b} · ${pair.evs.length} ${t('gr.events')}` : t('gr.pick')}
            </span>
          </h2>
        </div>
        <div className="pb" id="gSide">
          <Side pair={pair} onFlow={props.onFlow} />
        </div>
      </section>
    </>
  );
};
