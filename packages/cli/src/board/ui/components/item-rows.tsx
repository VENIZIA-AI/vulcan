import { useEffect, useRef } from 'react';
import { BoardTables } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardCards } from '../state/cards.ts';
import type { IItemCard } from '../state/cards.ts';
import { BoardTime } from '../state/time.ts';
import { BoardWork } from '../state/work.ts';
import { Mark } from './bits.tsx';
import { BoardFace } from './face.tsx';
import { StatusMark } from './icons.tsx';

const SOON_DAYS = 2;
/** Up to this many steps a bar draws one segment each; more draw as one bar. */
const SEGMENTS_MAX = 12;
const TOKENS = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });

/** How far along, one segment a step: `done` of `total` filled. */
const Segments = (props: { done: number; total: number }) => (
  <span className="segs" aria-hidden="true">
    {props.total > SEGMENTS_MAX ? (
      <span className="seg-bar">
        <span style={{ width: `${Math.round((props.done / props.total) * 100)}%` }} />
      </span>
    ) : (
      Array.from({ length: props.total }, (_, index) => (
        <span key={index} className={index < props.done ? 'on' : undefined} />
      ))
    )}
  </span>
);

/** A flow's place in the work order, small, before its id; nothing when it has none. */
const Order = (props: { order: number | undefined }) =>
  props.order === undefined ? null : <b className="c-order">{props.order}</b>;

const Due = (props: { due: string | undefined }) => {
  const { t, now } = useUi();

  if (props.due === undefined) {
    return <span className="c-badge b-idle">{t('it.noDue')}</span>;
  }

  const days = BoardCards.daysLeft({ due: props.due, now });
  let when = `${days} ${t(days === 1 ? 'it.dayLeft' : 'it.daysLeft')}`;

  if (days < 0) {
    when = t('it.overdue');
  }

  return (
    <span
      className={`c-badge ${days <= SOON_DAYS ? 'b-ask' : 'b-idle'}`}
    >{`${t('fl.due')} ${props.due} · ${when}`}</span>
  );
};

const Stage = (props: { view: IFlowView }) => {
  const { t } = useUi();
  const { view } = props;

  return (
    <span className="c-badge b-stage">
      {view.noWork ? t('nw.chip') : t(BoardTables.STAGES[view.flow.cur])}
    </span>
  );
};

/** The state of a flow as a mark and a word, the same in every view. */
const State = (props: { state: string }) => {
  const { t } = useUi();

  return (
    <span className={`state st-${props.state}`}>
      <StatusMark state={props.state} />
      {t(BoardTables.STATE_TEXT[props.state])}
    </span>
  );
};

/** A person or an agent by name, with the dot of its colour. */
const Who = (props: { name: string; holds?: boolean }) => {
  const { t } = useUi();

  return (
    <span className={`who${props.holds ? ' h' : ''}`} title={props.name}>
      <i style={{ background: BoardFace.colorOf({ name: props.name }) }} />
      {props.name}
      {props.holds ? <span className="sr">{` ${t('it.holds')}`}</span> : null}
    </span>
  );
};

const Stale = () => {
  const { t } = useUi();

  return (
    <span className="c-badge b-stale" title={BoardWork.staleTip({ t })}>
      {t('it.stale')}
    </span>
  );
};

/** What a row of the list does when picked: the same for a card, a compact row and a table row. */
const usePick = (opts: { id: string; selected: boolean; onSelect: (id: string) => void }) => {
  const node = useRef<Element | null>(null);

  useEffect(() => {
    if (opts.selected) {
      node.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [opts.selected]);

  return {
    ref: (element: Element | null) => {
      node.current = element;
    },
    'data-id': opts.id,
    tabIndex: 0,
    'aria-current': opts.selected || undefined,
    onClick: () => opts.onSelect(opts.id),
    onKeyDown: (event: {
      key: string;
      target: unknown;
      currentTarget: unknown;
      preventDefault: () => void;
    }) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) {
        event.preventDefault();
        opts.onSelect(opts.id);
      }
    },
  };
};

const PrList = (props: { prs: IItemCard['prs'] }) => {
  const { t } = useUi();

  return (
    <span className="c-prs">
      {props.prs.map((pr) => (
        <span key={pr.label} className="c-pr">
          {pr.label}
          {pr.ci === null ? null : (
            <b className={pr.ci === 'fail' ? 'bad' : 'good'}>
              <Mark bad={pr.ci === 'fail'} />
              {`CI ${t(pr.ci === 'fail' ? 'lỗi' : 'đạt')}`}
            </b>
          )}
        </span>
      ))}
    </span>
  );
};

interface IRowProps {
  view: IFlowView;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** One flow: where it is, what is happening now, how far along, who is on it, and what it waits for. */
export const ItemCard = (props: IRowProps & { card: IItemCard }) => {
  const { t, now } = useUi();
  const { view, card } = props;
  const { flow } = view;
  const clock = (iso: string): string => BoardTime.clock({ iso });
  const pick = usePick({ id: flow.id, selected: props.selected, onSelect: props.onSelect });

  return (
    <div className={`c-card row${props.selected ? ' sel' : ''}`} role="button" {...pick}>
      <div className="c-head">
        <span className="c-id">
          <Order order={flow.order} />
          {flow.id}
        </span>
        {flow.tracker ? <span className="c-ref">{flow.tracker}</span> : null}
        <Stage view={view} />
        {BoardWork.isStale({ flow, now }) ? <Stale /> : null}
        {view.newCount > 0 ? (
          <span className="unread" title={`${view.newCount}${t(' sự kiện mới')}`} />
        ) : null}
        <span className="c-grow" />
        <Due due={flow.due} />
      </div>
      <div className="c-title">{flow.title}</div>
      {card.now ? <div className="c-now">{`${t('it.now')}: ${card.now}`}</div> : null}
      <div className="c-meta">
        {card.steps.total > 0 ? (
          <span className="m">
            <span className="k">{t('fl.steps')}</span>
            <Segments {...card.steps} />
            <b className="num">{`${card.steps.done}/${card.steps.total}`}</b>
          </span>
        ) : null}
        {card.checks.total > 0 ? (
          <span className="m">
            <span className="k">{t('it.checks')}</span>
            <b className="num">{`${card.checks.done}/${card.checks.total}`}</b>
          </span>
        ) : null}
        {card.prs.length > 0 ? <PrList prs={card.prs} /> : null}
        {flow.apps ? (
          <span className="c-apps">
            {flow.apps.map((app) => (
              <span key={app}>{app}</span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="c-people">
        <span className="c-chips">
          {card.people.map((person, index) => (
            <Who key={person} name={person} holds={index === 0} />
          ))}
        </span>
      </div>
      {card.waiting ? (
        <div className="c-wait">
          <span className="k">{t('it.waiting')}</span> {card.waiting}
        </div>
      ) : null}
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
        <span>
          {t('it.latest')} <b>{clock(view.last.ts)}</b>
        </span>
      </div>
    </div>
  );
};

/** How long ago the flow's newest line was. */
const Updated = (props: { view: IFlowView }) => {
  const { t, now } = useUi();
  const last = BoardWork.updatedAt({ view: props.view });

  return (
    <time className="c-ago" dateTime={last} title={BoardTime.clock({ iso: last })}>
      {BoardTime.ago({ iso: last, now, translate: t })}
    </time>
  );
};

/** One line per flow: code, title, stage, steps and when it last moved. */
export const CompactRow = (props: IRowProps) => {
  const { t, now } = useUi();
  const { view } = props;
  const steps = BoardCards.itemOf({ view }).steps;
  const pick = usePick({ id: view.flow.id, selected: props.selected, onSelect: props.onSelect });

  return (
    <div className={`c-line row${props.selected ? ' sel' : ''}`} role="button" {...pick}>
      <StatusMark state={view.flow.state} />
      <span className="c-id">
        <Order order={view.flow.order} />
        {view.flow.id}
      </span>
      <span className="c-lt" title={view.flow.title}>
        {view.flow.title}
      </span>
      <span className="c-lm">
        {BoardWork.isStale({ flow: view.flow, now }) ? <Stale /> : null}
        <Stage view={view} />
      </span>
      <span className="c-ls" title={t('fl.steps')}>
        {steps.total > 0 ? (
          <>
            <Segments {...steps} />
            <span className="num">{`${steps.done}/${steps.total}`}</span>
          </>
        ) : null}
      </span>
      <Who name={view.holder} />
      <Updated view={view} />
    </div>
  );
};

/** A token figure of the table: the total, and a second line under it; the full text is the title. Empty with no tokens. */
const TokenCell = (props: { total: number | undefined; note: string }) =>
  props.total === undefined ? (
    <td className="num" />
  ) : (
    <td className="num t-tk" title={`${props.total.toLocaleString('en-US')}\n${props.note}`}>
      {TOKENS.format(props.total)}
      <small>{props.note}</small>
    </td>
  );

/** One row of the table; a cell with nothing to say is empty. */
export const TableRow = (props: IRowProps) => {
  const { t, now } = useUi();
  const { view } = props;
  const { flow } = view;
  const card = BoardCards.itemOf({ view });
  const { tokens } = flow;
  const pick = usePick({ id: flow.id, selected: props.selected, onSelect: props.onSelect });

  return (
    <tr className={`row${props.selected ? ' sel' : ''}`} {...pick}>
      <td className="c-order-cell">{flow.order ?? ''}</td>
      <td className="c-id" title={flow.id}>
        {flow.id}
      </td>
      <td className="t-title">
        <div>
          <span title={flow.title}>{flow.title}</span>
          {BoardWork.isStale({ flow, now }) ? <Stale /> : null}
        </div>
      </td>
      <td>
        <Stage view={view} />
      </td>
      <td>
        <State state={flow.state} />
      </td>
      <td>
        <Who name={view.holder} />
      </td>
      <td>
        {card.steps.total > 0 ? (
          <span className="t-steps">
            <Segments {...card.steps} />
            <span className="num">{`${card.steps.done}/${card.steps.total}`}</span>
          </span>
        ) : null}
      </td>
      <td>{card.prs.length > 0 ? <PrList prs={card.prs} /> : null}</td>
      <TokenCell
        total={tokens === undefined ? undefined : BoardWork.readOf({ counts: tokens })}
        note={
          tokens === undefined
            ? ''
            : BoardWork.readNote({ counts: tokens, format: TOKENS.format, translate: t })
        }
      />
      <TokenCell
        total={tokens?.output}
        note={
          tokens === undefined
            ? ''
            : BoardWork.writtenNote({ counts: tokens, format: TOKENS.format, translate: t })
        }
      />
      <td className="num">{flow.due ?? ''}</td>
      <td>
        <Updated view={view} />
      </td>
    </tr>
  );
};
