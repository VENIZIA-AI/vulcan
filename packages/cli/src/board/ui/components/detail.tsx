import type { ReactNode } from 'react';
import { BoardTables } from '../common/constants.ts';
import type { IBoardViewEvent, IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardLatest } from '../state/latest.ts';
import { BoardTime } from '../state/time.ts';
import { BoardView } from '../state/view.ts';
import { EventItem, FlowCode, Mark, Untitled } from './bits.tsx';

const isBad = (event: { status?: string }): boolean =>
  event.status === 'fail' || event.status === 'blocked';
const approxMark = (events: IBoardViewEvent[]): string =>
  events.some((event) => BoardTime.isApproximate({ source: event.source })) ? '≈' : '';

/** What the flow is: its title, why it exists, what is done and left, the next step, the latest lines and who holds it. */
const Head = (props: { view: IFlowView; onClose: () => void }) => {
  const { t, now } = useUi();
  const { view } = props;
  const { flow } = view;
  const latest = view.evs
    .filter((event) => !event.plumbing && event.kind !== 'flow')
    .slice(-3)
    .reverse();
  const decided = view.dec && (!view.lastAsk || view.dec.at > view.lastAsk.ts);

  return (
    <div className="dh">
      <div className="top">
        <button className="btn back" type="button" onClick={props.onClose}>
          {t('Quay lại')}
        </button>
        <FlowCode id={flow.id} />
        <span className="repo">{flow.repo}</span>
        <span className={`pill ${flow.state}`}>{t(BoardTables.STATE_TEXT[flow.state])}</span>
      </div>
      <h3>
        {flow.title}
        {view.named ? null : <Untitled />}
      </h3>
      {flow.why ? <p className="why">{flow.why}</p> : null}
      {flow.context ? (
        <div className="ctx">
          <div className="lb">{t('ctx.label')}</div>
          <p>{flow.context}</p>
        </div>
      ) : null}
      {flow.next ? (
        <p className="nx">
          <b>{`${t('nx.label')}: `}</b>
          {flow.next}
        </p>
      ) : null}
      {latest.length > 0 ? (
        <div className="lat">
          <div className="lb">{t('lt.label')}</div>
          <ul>
            {latest.map((event) => (
              <li key={event.id}>
                <span className="tm">
                  {approxMark([event])}
                  {BoardTime.clock({ iso: event.ts })}
                </span>
                <span>{BoardLatest.textOf({ event, translate: t })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="meta">
        {(
          [
            ['Đang giữ', view.holder],
            [
              'Sự kiện cuối',
              `${view.approxLast ? '≈ ' : ''}${BoardTime.ago({ iso: view.last.ts, now, translate: t })}${t(' trước')}`,
            ],
            ['Bắt đầu', BoardTime.clock({ iso: view.evs[0].ts })],
            ['Sự kiện', String(view.evs.length)],
          ] as const
        ).map(([label, value]) => (
          <span key={label}>
            {`${t(label)} `}
            <b>{value}</b>
          </span>
        ))}
      </div>
      {flow.state === 'you' && view.lastAsk ? (
        <div className="ask">{view.lastAsk.summary}</div>
      ) : null}
      {view.dec && decided ? (
        <div className="meta">{`${t('Anh đã chọn ')}${view.dec.choice === 'approve' ? t('Duyệt') : t('Để sau')}${t(' lúc ')}${BoardTime.clock({ iso: view.dec.at })}`}</div>
      ) : null}
    </div>
  );
};

/** `cur` for the stage a flow is at, `done` for those before it. */
const stageClass = (opts: { stage: number; cur: number }): string => {
  if (opts.stage === opts.cur) {
    return 'cur';
  }

  return opts.stage < opts.cur ? 'done' : '';
};

/** The stages the flow went through, newest last; a stage with more than one round has a button per round. */
const Timeline = (props: {
  view: IFlowView;
  attempts: Record<string, number>;
  onAttempt: (key: string, round: number) => void;
}) => {
  const { t } = useUi();
  const { view } = props;

  return (
    <ol className="tl">
      {view.flow.stages.map((k) => {
        const evs = view.evs.filter((event) => event.stage === k && event.kind !== 'flow');

        if (evs.length === 0) {
          return null;
        }

        const last = evs[evs.length - 1];
        const key = `${view.flow.id}:${k}`;
        const rounds = [...new Set(evs.map((event) => event.attempt ?? 1))].sort(
          (left, right) => left - right,
        );
        const picked = props.attempts[key] ?? rounds[rounds.length - 1];
        const shown =
          rounds.length > 1 ? evs.filter((event) => (event.attempt ?? 1) === picked) : evs;
        const state = stageClass({ stage: k, cur: view.flow.cur });

        return (
          <li key={k} className={`st ${state}${isBad(last) && k === view.flow.cur ? ' fail' : ''}`}>
            <span className="k" />
            <div>
              <div className="h">
                <span className="nm">{t(BoardTables.STAGES[k])}</span>
                <span className="tm">
                  {approxMark(evs)}
                  {BoardTime.clock({ iso: evs[0].ts })}
                  {evs.length > 1 ? `–${BoardTime.clock({ iso: last.ts })}` : ''}
                </span>
                <span className="tm">{`${evs.length}${t(' sự kiện')}`}</span>
              </div>
              {rounds.length > 1 ? (
                <div
                  className="att"
                  role="group"
                  aria-label={`${t('Vòng của ')}${t(BoardTables.STAGES[k])}`}
                >
                  {rounds.map((round) => (
                    <button
                      key={round}
                      type="button"
                      aria-pressed={round === picked}
                      onClick={() => props.onAttempt(key, round)}
                    >
                      {`${t('Vòng ')}${round} `}
                      <Mark
                        bad={evs.some((event) => (event.attempt ?? 1) === round && isBad(event))}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="evs">
                {shown.map((event) => (
                  <EventItem key={event.id} event={event} />
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

/** All the lines when asked for, else the stages; a flow with no work has neither. */
const Body = (props: {
  view: IFlowView;
  everything: boolean;
  attempts: Record<string, number>;
  onAttempt: (key: string, round: number) => void;
}) => {
  const { t } = useUi();
  const { view } = props;

  if (props.everything) {
    return (
      <ul className="evs" style={{ padding: '8px 16px 16px' }}>
        {view.evs.map((event) => (
          <EventItem key={event.id} event={event} />
        ))}
      </ul>
    );
  }

  if (view.noWork) {
    return <p className="nowork">{t('nw.empty')}</p>;
  }

  return <Timeline view={view} attempts={props.attempts} onAttempt={props.onAttempt} />;
};

interface IDetailProps {
  views: IFlowView[];
  events: IBoardViewEvent[];
  selected: string | null;
  open: boolean;
  diagramMode: boolean;
  diagram: (view: IFlowView) => ReactNode;
  everything: boolean;
  onEverything: (value: boolean) => void;
  attempts: Record<string, number>;
  onAttempt: (key: string, round: number) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** What nothing is picked shows: the day in numbers and the newest lines of all flows. */
const Today = (props: IDetailProps) => {
  const { t, now } = useUi();
  const count = (state: string): number =>
    props.views.filter(
      (view) =>
        view.flow.state === state &&
        (state !== 'done' || BoardTime.isSameDay({ iso: view.last.ts, now })),
    ).length;
  const recent = props.events
    .filter((event) => event.kind !== 'flow')
    .sort(BoardView.byTime)
    .reverse()
    .slice(0, 14);

  return (
    <div id="dEmpty">
      <div className="dh">
        <h3>
          <span>{t('Hôm nay')}</span>
        </h3>
        <p className="meta" id="sumLine">
          {`${count('you')}${t(' luồng cần anh · ')}${count('blocked')}${t(' bị chặn · ')}${count('running')}${t(' đang chạy · ')}${count('done')}${t(' xong hôm nay')}`}
        </p>
        <p className="meta">
          <span>
            {t(
              'Chọn một luồng ở bên trái để xem từng bước, từng vòng review và tin nhắn. Phím j, k để chuyển, Enter để mở.',
            )}
          </span>
        </p>
      </div>
      <h4 className="dlabel">
        <span>{t('Sự kiện mới nhất')}</span>
      </h4>
      <ul className="evs" id="recent" style={{ padding: '8px 16px 16px' }}>
        {recent.map((event) => (
          <EventItem
            key={event.id}
            event={event}
            chip={
              <button
                className="btn chip"
                type="button"
                title={props.views.find((view) => view.flow.id === event.flowId)?.flow.title ?? ''}
                onClick={() => props.onSelect(event.flowId)}
              >
                {event.flowId}
              </button>
            }
          />
        ))}
      </ul>
    </div>
  );
};

/** The right pane: the flow picked, or the day when none is. */
export const Detail = (props: IDetailProps) => {
  const { t } = useUi();
  const view = props.views.find((one) => one.flow.id === props.selected);

  return (
    <section
      className={`pane detail${props.open ? ' open' : ''}${props.diagramMode ? ' dgmode' : ''}`}
      id="detail"
      aria-label={t('Chi tiết luồng')}
      data-comment-target=""
    >
      <div className="pb">
        {view === undefined ? (
          <Today {...props} />
        ) : (
          <div id="dBody">
            <Head view={view} onClose={props.onClose} />
            {props.diagramMode && !view.noWork ? props.diagram(view) : null}
            <div className="dtabs" role="tablist">
              <button
                className="tab"
                type="button"
                role="tab"
                aria-selected={!props.everything}
                onClick={() => props.onEverything(false)}
              >
                {t('Các bước')}
              </button>
              <button
                className="tab"
                type="button"
                role="tab"
                aria-selected={props.everything}
                onClick={() => props.onEverything(true)}
              >
                {`${t('Mọi sự kiện (')}${view.evs.length})`}
              </button>
            </div>
            <Body
              view={view}
              everything={props.everything}
              attempts={props.attempts}
              onAttempt={props.onAttempt}
            />
          </div>
        )}
      </div>
    </section>
  );
};
