import { BoardTables, BoardUiConstants } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { useT } from '../i18n/context.ts';

const BOX_W = 128;
const BOX_H = 74;
const GAP = 38;
const TOP = 34;
const MARKERS = [
  { id: 'ah', color: 'var(--line-2)' },
  { id: 'ahh', color: 'var(--accent)' },
  { id: 'ahl', color: 'var(--wait)' },
];
const xOf = (index: number): number => 4 + index * (BOX_W + GAP);
const REVIEW_STAGE = 5;
const CODE_STAGE = 3;

/** One flow as boxes joined by arrows: a stage per box, a handover marked, and a loop back when review sent it to be fixed. */
export const FlowDiagram = (props: { view: IFlowView; owner: string }) => {
  const t = useT();
  const { view } = props;
  const stages = view.flow.stages;
  const width = stages.length * BOX_W + (stages.length - 1) * GAP + 8;
  const height = BOX_H + TOP + 40;
  const holderOf = (stage: number): string => {
    const doer = view.evs.findLast(
      (event) => event.stage === stage && !BoardUiConstants.NOT_AGENTS.has(event.actor),
    );

    if (doer === undefined) {
      return '';
    }

    return doer.to && doer.kind !== 'review' ? doer.to : doer.actor;
  };
  const rounds = (view.att[REVIEW_STAGE] ?? []).filter((event) => event.kind === 'review').length;
  const reviewAt = stages.indexOf(REVIEW_STAGE);
  const from = stages.indexOf(CODE_STAGE) >= 0 ? stages.indexOf(CODE_STAGE) : reviewAt - 1;
  const loopStart = xOf(reviewAt) + BOX_W / 2;
  const loopEnd = xOf(from) + BOX_W / 2;

  return (
    <div className="dg">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${t('dg.title')} ${view.flow.id}`}
      >
        <defs>
          {MARKERS.map((marker) => (
            <marker
              key={marker.id}
              id={marker.id}
              viewBox="0 0 10 10"
              refX={9}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill={marker.color} />
            </marker>
          ))}
        </defs>
        {stages.map((k, index) => {
          const evs = view.evs.filter((event) => event.stage === k);
          const current = k === view.flow.cur;
          const waiting = current && view.flow.state === 'you';
          const stuck = current && view.flow.state === 'blocked';
          const holder = waiting ? props.owner : holderOf(k);
          const here = view.att[k] ?? [];
          const ci = here
            .filter((event) => event.kind === 'ci' || event.kind === 'release')
            .slice(-4);
          const reviews = here.filter((event) => event.kind === 'review');
          const previous = index > 0 ? holderOf(stages[index - 1]) : '';
          const handover = index > 0 && previous !== '' && holder !== '' && previous !== holder;
          const arrowFrom = xOf(index - 1) + BOX_W;
          const arrowY = TOP + BOX_H / 2;
          const kind = BoardTables.KIND_TEXT[evs[0].kind];
          let tone = '';

          if (waiting) {
            tone = 'you';
          } else if (stuck) {
            tone = 'blocked';
          } else if (current) {
            tone = 'cur';
          } else if (k < view.flow.cur) {
            tone = 'done';
          }

          return (
            <g key={k}>
              <g className={`blk ${tone}`} transform={`translate(${xOf(index)},${TOP})`}>
                <rect width={BOX_W} height={BOX_H} rx={4} />
                <text x={10} y={20} className="nm">
                  {t(BoardTables.STAGES[k])}
                </text>
                <text x={10} y={40} className="who">
                  {holder.slice(0, 18)}
                </text>
                <text x={10} y={60} className="att">
                  {ci.length > 0 ? 'CI' : null}
                  {ci.length === 0 && reviews.length === 0
                    ? `${evs.length} ${t('gr.events')}`
                    : null}
                </text>
                {ci.map((event, order) => {
                  const x = 30 + order * 11;
                  const bad = event.status === 'fail';

                  return (
                    <path
                      key={event.id}
                      d={bad ? `M${x} 52l6 6M${x + 6} 52l-6 6` : `M${x} 55.5l2.2 2.2 4.3-4.8`}
                      fill="none"
                      stroke={bad ? 'var(--fail)' : 'var(--ok)'}
                      strokeWidth={1.7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}
                {reviews.length > 0 ? (
                  <text x={ci.length > 0 ? 30 + ci.length * 11 + 6 : 10} y={60} className="att">
                    {`${t('Review')} ×${reviews.length}`}
                  </text>
                ) : null}
              </g>
              {index > 0 ? (
                <path
                  d={`M${arrowFrom} ${arrowY}H${xOf(index) - 2}`}
                  className={`arr${handover ? ' hand' : ''}`}
                  markerEnd={handover ? 'url(#ahh)' : 'url(#ah)'}
                />
              ) : null}
              {handover ? (
                <text
                  x={(arrowFrom + xOf(index)) / 2}
                  y={arrowY - 8}
                  textAnchor="middle"
                  className="lab hand"
                >
                  {kind ? t(kind) : evs[0].kind}
                </text>
              ) : null}
            </g>
          );
        })}
        {reviewAt > 0 && rounds > 1 ? (
          <>
            <path
              d={`M${loopStart} ${TOP}C${loopStart} ${TOP - 30} ${loopEnd} ${TOP - 30} ${loopEnd} ${TOP - 2}`}
              className="loop"
              markerEnd="url(#ahl)"
            />
            <text
              x={(loopStart + loopEnd) / 2}
              y={TOP - 20}
              textAnchor="middle"
              className="lab loop"
            >
              {`${t('Review')} → ${t('sửa')} ×${rounds} ${t('rounds')}`}
            </text>
          </>
        ) : null}
      </svg>
    </div>
  );
};
