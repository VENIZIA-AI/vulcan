import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { BoardTables } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardCards } from '../state/cards.ts';
import type { IItemCard } from '../state/cards.ts';
import { BoardTime } from '../state/time.ts';
import { BoardView } from '../state/view.ts';
import { Untitled } from './bits.tsx';
import { Chevron } from './icons.tsx';

const STATE_TONES: Record<string, string> = {
  you: 'wait',
  blocked: 'ask',
  running: 'work',
  parked: 'idle',
  done: 'ok',
};
const SOON_DAYS = 2;

const Pair = (props: { label: string; children: ReactNode }) => (
  <>
    <span className="c-k">{props.label}</span>
    <span className="c-v">{props.children}</span>
  </>
);

const Progress = (props: { done: number; total: number; label: string }) => (
  <span className="c-v c-mini">
    <span className="c-bar">
      <span style={{ width: `${Math.round((props.done / props.total) * 100)}%` }} />
    </span>
    {`${props.done}/${props.total} ${props.label}`}
  </span>
);

const Due = (props: { due: string | undefined }) => {
  const { t, now } = useUi();

  if (props.due === undefined) {
    return <span className="c-badge b-idle">{t('it.noDue')}</span>;
  }

  const days = BoardCards.daysLeft({ due: props.due, now });
  const when = days < 0 ? t('it.overdue') : `${days} ${t('it.daysLeft')}`;

  return (
    <span
      className={`c-badge ${days <= SOON_DAYS ? 'b-ask' : 'b-idle'}`}
    >{`${t('fl.due')} ${props.due} · ${when}`}</span>
  );
};

/** One flow: where it is, what is happening now, how far along, who is on it, and what it waits for. */
const ItemCard = (props: {
  view: IFlowView;
  card: IItemCard;
  selected: boolean;
  onSelect: (id: string) => void;
}) => {
  const { t } = useUi();
  const { view, card } = props;
  const { flow } = view;
  const ref = useRef<HTMLDivElement>(null);
  // What it waits for: the next step, else the question that is asked of the owner.
  const waitsFor =
    flow.state === 'you' || flow.state === 'blocked'
      ? (flow.next ?? view.lastAsk?.summary)
      : undefined;
  const clock = (iso: string): string => BoardTime.clock({ iso });

  useEffect(() => {
    if (props.selected) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [props.selected]);

  return (
    <div
      ref={ref}
      className={`c-card row${props.selected ? ' sel' : ''}`}
      data-id={flow.id}
      role="button"
      tabIndex={0}
      aria-selected={props.selected}
      onClick={() => props.onSelect(flow.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault();
          props.onSelect(flow.id);
        }
      }}
    >
      <div className="c-head">
        <span className={`c-badge b-${STATE_TONES[flow.state]}`}>
          {view.noWork ? t('nw.chip') : t(BoardTables.STAGES[flow.cur])}
        </span>
        <span className="c-id">{flow.id}</span>
        {flow.tracker ? <span className="c-ref">{flow.tracker}</span> : null}
        {view.newCount > 0 ? (
          <span className="unread" title={`${view.newCount}${t(' sự kiện mới')}`} />
        ) : null}
        <span className="c-grow" />
        <Due due={flow.due} />
      </div>
      <div className="c-title">
        {flow.title}
        {view.named ? null : <Untitled />}
      </div>
      {card.now ? <div className="c-now">{`${t('it.now')}: ${card.now}`}</div> : null}
      <div className="c-wb">
        {card.steps.total > 0 ? (
          <Pair label={t('fl.steps')}>
            <Progress {...card.steps} label={t('it.done')} />
          </Pair>
        ) : null}
        {card.checks.total > 0 ? (
          <Pair label={t('it.checks')}>
            <Progress {...card.checks} label={t('it.criteria')} />
          </Pair>
        ) : null}
        {flow.apps ? (
          <Pair label={t('it.apps')}>
            <span className="c-chips">
              {flow.apps.map((app) => (
                <span key={app}>{app}</span>
              ))}
            </span>
          </Pair>
        ) : null}
        {card.prs.length > 0 ? (
          <Pair label={t('it.prs')}>
            {card.prs.map((pr) => (
              <span key={pr.label} className="c-pr">
                {pr.label}
                {pr.ci === null ? null : (
                  <b
                    className={pr.ci === 'fail' ? 'bad' : 'good'}
                  >{` ● CI ${t(pr.ci === 'fail' ? 'lỗi' : 'đạt')}`}</b>
                )}
              </span>
            ))}
          </Pair>
        ) : null}
        <Pair label={t('it.people')}>
          <span className="c-chips">
            {card.people.map((person, index) => (
              <span key={person} className={index === 0 ? 'h' : undefined}>
                {index === 0 ? `${person} ${t('it.holds')}` : person}
              </span>
            ))}
          </span>
        </Pair>
        {waitsFor ? <Pair label={t('it.waiting')}>{waitsFor}</Pair> : null}
      </div>
      <div className="c-foot">
        <span>
          {t('it.started')} <b>{clock(view.evs[0].ts)}</b>
        </span>
        <span>
          {t('it.updates')} <b>{card.updates}</b>
        </span>
        {card.deploys.length > 0 ? (
          <span>
            {t('it.deploys')} <b>{card.deploys.join(', ')}</b>
          </span>
        ) : null}
        <span className="c-r">{`${t('it.latest')} ${clock(view.last.ts)}`}</span>
      </div>
    </div>
  );
};

/** The middle pane: the work, grouped by who it waits on. */
export const ItemPane = (props: {
  views: IFlowView[];
  agent: string | null;
  onAgent: (name: string | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
}) => {
  const { t, now } = useUi();
  const shown = props.views.filter(
    (view) => props.agent === null || BoardView.involves({ view, name: props.agent }),
  );

  return (
    <section className="c-pane" aria-label={t('Danh sách luồng')}>
      <div className="c-ph">
        {t('pn.items')}{' '}
        <span className="c-n" id="flowN">
          {shown.length}
        </span>
        {props.agent === null ? null : (
          <button
            className="btn filter-chip"
            type="button"
            aria-label={`${t('Bỏ lọc theo ')}${props.agent}`}
            onClick={() => props.onAgent(null)}
          >
            {t('Của ')}
            <b>{props.agent}</b> ×
          </button>
        )}
      </div>
      <div className="c-scroll" id="groups">
        {shown.length === 0 ? (
          <p className="c-empty">
            {t('Chưa có luồng nào. Bật events.log, hoặc ghi một dòng bằng vulcan event add.')}
          </p>
        ) : null}
        {BoardTables.GROUPS.map((group) => {
          const items = shown
            .filter(
              (view) =>
                view.flow.state === group.key &&
                (group.key !== 'done' || BoardTime.isSameDay({ iso: view.last.ts, now })),
            )
            .sort((left, right) =>
              group.key === 'you' || group.key === 'blocked'
                ? BoardView.byTime(left.last, right.last)
                : BoardView.byTime(right.last, left.last),
            );
          const open = props.open[group.key] ?? group.open;

          if (shown.length === 0) {
            return null;
          }

          return (
            <section key={group.key} className="c-group">
              <button
                className="c-gh"
                type="button"
                aria-expanded={open}
                onClick={() => props.onToggle(group.key)}
              >
                <Chevron />
                <span className="c-dot" style={{ background: group.swatch }} />
                <span>{`${t(group.label)} · ${items.length}`}</span>
              </button>
              {open && items.length === 0 ? (
                <p className="c-empty">
                  {group.key === 'you' ? t('Không có gì chờ anh.') : t('Trống.')}
                </p>
              ) : null}
              {open
                ? items.map((view) => (
                    <ItemCard
                      key={view.flow.id}
                      view={view}
                      card={BoardCards.itemOf({ view })}
                      selected={props.selected === view.flow.id}
                      onSelect={props.onSelect}
                    />
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </section>
  );
};
