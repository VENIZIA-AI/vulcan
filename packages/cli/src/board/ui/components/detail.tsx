import type { ReactNode } from 'react';
import type { IBoardData } from '../../common/index.ts';
import { BoardConstants } from '../../common/index.ts';
import { BoardStateWords, BoardTables } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardAgentInfo } from '../state/agent-info.ts';
import { BoardCards } from '../state/cards.ts';
import type { IAgentCard } from '../state/cards.ts';
import { BoardTime } from '../state/time.ts';
import { BoardUrl } from '../url.ts';
import { AGENT_TONES } from './agents.tsx';
import { Bar, Checklist, EventItem, Mark } from './bits.tsx';
import { BoardFace, Mascot } from './face.tsx';

const MILESTONES: Record<string, string> = {
  decision: 'ms.decision',
  merge: 'ms.merge',
  release: 'ms.deploy',
};
const RECENT_LINES = 5;
const LOOSE_LINES = 200;

/** `cur` for the stage a flow is at, `done` for those before it. */
const stageClass = (opts: { stage: number; cur: number }): string => {
  if (opts.stage === opts.cur) {
    return 'st cur';
  }

  return opts.stage < opts.cur ? 'st done' : 'st';
};

const Section = (props: { title: string; children: ReactNode }) => (
  <div className="d-sec">
    <h4>{props.title}</h4>
    {props.children}
  </div>
);

/** The lines that mark the flow's way: it was opened, decided, merged, deployed. Newest first. */
const Milestones = (props: { view: IFlowView }) => {
  const { t } = useUi();
  const marks = props.view.evs
    .filter((event, index) => index === 0 || event.kind in MILESTONES)
    .map((event, index) => ({ event, tag: index === 0 ? 'ms.open' : MILESTONES[event.kind] }))
    .reverse();

  return (
    <div className="d-up">
      {marks.map(({ event, tag }, index) => (
        <div key={event.id} className={`d-u${index === 0 ? ' last' : ''}`}>
          <time>{BoardTime.clock({ iso: event.ts })}</time>
          <span className="d-tag">{t(tag)}</span>
          {event.summary}
        </div>
      ))}
    </div>
  );
};

/** The events that name no flow: not a work item, so only a list, newest first. */
const LooseDetail = (props: { view: IFlowView }) => {
  const { t } = useUi();

  return (
    <div id="dBody" className="d-body">
      <h2>{t('it.unsorted')}</h2>
      <p className="d-empty">{t('it.unsortedNote')}</p>
      <ul className="evs">
        {[...props.view.evs]
          .reverse()
          .slice(0, LOOSE_LINES)
          .map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
      </ul>
    </div>
  );
};

/** A flow in full: what it is, how far along, what waits, and the way it went. */
const FlowDetail = (props: {
  view: IFlowView;
  everything: boolean;
  onEverything: (value: boolean) => void;
}) => {
  const { t } = useUi();
  const { view } = props;
  const { flow } = view;
  const card = BoardCards.itemOf({ view });

  return (
    <div id="dBody" className="d-body">
      <h2>{flow.title}</h2>
      <div className="d-meta">
        <span className="c-id">{flow.id}</span>
        {flow.tracker ? <span className="c-ref">{flow.tracker}</span> : null}
        {flow.due ? <span>{`${t('fl.due')} ${flow.due}`}</span> : null}
        <span>
          {t('it.holder')}: <span className="d-who">{view.holder}</span>
        </span>
      </div>
      {view.noWork ? null : (
        <>
          <div className="d-stages">
            {BoardTables.STAGES.map((name, stage) => (
              <span key={name} title={t(name)} className={stageClass({ stage, cur: flow.cur })} />
            ))}
          </div>
          <div className="d-stl">
            <span>{t(BoardTables.STAGES[0])}</span>
            <b>{t(BoardTables.STAGES[flow.cur])}</b>
            <span>{t(BoardTables.STAGES[BoardTables.STAGES.length - 1])}</span>
          </div>
        </>
      )}
      {flow.context || flow.apps ? (
        <Section title={t('dt.whatItIs')}>
          {flow.context ? <p>{flow.context}</p> : null}
          {flow.apps ? (
            <div className="c-chips">
              {flow.apps.map((app) => (
                <span key={app}>{app}</span>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}
      {flow.steps && flow.steps.length > 0 ? (
        <Section title={`${t('fl.steps')} · ${card.steps.done}/${card.steps.total}`}>
          <Bar {...card.steps} />
          <Checklist items={flow.steps} />
        </Section>
      ) : null}
      {flow.checks && flow.checks.length > 0 ? (
        <Section title={`${t('fl.checks')}${flow.tracker ? ` · ${flow.tracker}` : ''}`}>
          <Checklist items={flow.checks} />
        </Section>
      ) : null}
      {card.waiting ? (
        <div className="d-sec d-waiting">
          <span className="d-k">{t('it.waiting')}</span>
          <span>{card.waiting}</span>
        </div>
      ) : null}
      {view.noWork ? <p className="d-empty">{t('nw.empty')}</p> : null}
      <Section title={t('dt.milestones')}>
        <Milestones view={view} />
      </Section>
      <button
        className="btn d-all"
        type="button"
        aria-pressed={props.everything}
        onClick={() => props.onEverything(!props.everything)}
      >
        {`${t('dt.all')} (${view.evs.length})`}
      </button>
      {props.everything ? (
        <ul className="evs">
          {view.evs.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

/** An agent in full: its latest lines, the pull requests it has open and the messages nobody has answered. */
const AgentDetail = (props: {
  row: IAgentRow;
  card: IAgentCard;
  data: IBoardData;
  events: IBoardViewEvent[];
  shape: string;
  onFlow: (id: string) => void;
}) => {
  const { t, now } = useUi();
  const { row, card, data } = props;
  const info = BoardAgentInfo.of({ data, events: props.events, name: row.n });
  const clock = (iso: string): string => BoardTime.clock({ iso });

  return (
    <div id="dBody" className="d-body d-agent">
      <div className="d-agenthead">
        <Mascot state={row.st} name={row.n} shape={props.shape} />
        <div>
          <h2 id="popName">{row.n}</h2>
          <div className="d-meta">
            <span className={`c-badge b-${AGENT_TONES[row.st]}`}>
              {t(BoardStateWords.PILL[row.st])}
            </span>
            {card.since ? (
              <span>{`${t('từ ')}${clock(card.since)} · ${BoardTime.ago({ iso: card.since, now, translate: t })}`}</span>
            ) : null}
          </div>
        </div>
      </div>
      <Section title={t('5 sự kiện gần nhất')}>
        {info.mine.length === 0 ? (
          <p className="d-empty">{t('Chưa có sự kiện nào của agent này.')}</p>
        ) : (
          <ul className="d-list">
            {info.mine
              .slice(-RECENT_LINES)
              .reverse()
              .map((event) => (
                <li key={event.id}>
                  <time>{clock(event.ts)}</time>
                  {event.flowId ? (
                    <button
                      className="btn chip"
                      type="button"
                      onClick={() => props.onFlow(event.flowId)}
                    >
                      {event.flowId}
                    </button>
                  ) : null}
                  {event.summary}
                </li>
              ))}
          </ul>
        )}
      </Section>
      <Section title={`${t('PR đang mở (')}${info.open.length})`}>
        {info.open.length === 0 ? (
          <p className="d-empty">{t('Không có PR nào đang mở.')}</p>
        ) : (
          <ul className="d-list">
            {info.open.map((pr) => (
              <li key={`${pr.repo}#${pr.n}`}>
                <a
                  href={BoardUrl.safe({ value: BoardAgentInfo.prHref({ pr }) })}
                  target="_blank"
                  rel="noopener"
                >
                  {BoardAgentInfo.labelOf({ pr })}
                </a>
                {pr.ci ? <Mark bad={pr.ci === 'fail'} /> : null}
                {pr.flow}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`${t('Tin nhắn chưa có trả lời (')}${info.pending.length})`}>
        {info.pending.length === 0 ? (
          <p className="d-empty">{t('Không có tin nào đang chờ.')}</p>
        ) : (
          <ul className="d-list">
            {info.pending
              .slice(-RECENT_LINES)
              .reverse()
              .map((message) => {
                const { sender, receiver } = BoardAgentInfo.endsOf({ data, message });

                return (
                  <li key={message.id}>
                    <time>{clock(message.ts)}</time>
                    {`${sender === row.n ? `→ ${receiver ?? '?'}` : `← ${sender ?? '?'}`}: ${message.summary}`}
                  </li>
                );
              })}
          </ul>
        )}
      </Section>
    </div>
  );
};

export type TDetail = { kind: 'flow'; id: string } | { kind: 'agent'; name: string };

/** The right pane: the flow or the agent that was picked; it opens on a pick and closes with ✕ or Esc. */
export const Detail = (props: {
  detail: TDetail | null;
  views: IFlowView[];
  rows: IAgentRow[];
  cards: Record<string, IAgentCard>;
  data: IBoardData;
  events: IBoardViewEvent[];
  everything: boolean;
  onEverything: (value: boolean) => void;
  onFlow: (id: string) => void;
  onClose: () => void;
}) => {
  const { t } = useUi();
  const { detail } = props;
  const view =
    detail?.kind === 'flow' ? props.views.find((one) => one.flow.id === detail.id) : undefined;
  const row =
    detail?.kind === 'agent' ? props.rows.find((one) => one.n === detail.name) : undefined;

  return (
    <section
      className="c-pane c-p3"
      id="detail"
      aria-label={t('Chi tiết luồng')}
      hidden={view === undefined && row === undefined}
    >
      <div className="c-ph">
        {t('pn.detail')}
        <button
          className="c-x"
          type="button"
          title={t('Đóng')}
          aria-label={t('Đóng')}
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>
      <div className="c-scroll">
        {view && view.flow.id === BoardConstants.UNSORTED ? <LooseDetail view={view} /> : null}
        {view && view.flow.id !== BoardConstants.UNSORTED ? (
          <FlowDetail view={view} everything={props.everything} onEverything={props.onEverything} />
        ) : null}
        {row ? (
          <AgentDetail
            row={row}
            card={props.cards[row.n]}
            data={props.data}
            events={props.events}
            shape={BoardFace.shapeOf({ name: row.n, shapes: props.data.shapes })}
            onFlow={props.onFlow}
          />
        ) : null}
      </div>
    </section>
  );
};
