import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BoardConstants, BoardStates } from '../../common/index.ts';
import { BoardTables, BoardUiConstants } from '../common/constants.ts';
import type { IFlowView, TTranslate } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardCards } from '../state/cards.ts';
import type { IItemCard } from '../state/cards.ts';
import { BoardTime } from '../state/time.ts';
import { BoardView } from '../state/view.ts';
import { BoardWork } from '../state/work.ts';
import type { IWorkFilter, TWorkColumn, TWorkSort } from '../state/work.ts';
import { Bar } from './bits.tsx';
import { Chevron, SortArrow } from './icons.tsx';

export type TWorkView = 'cards' | 'compact' | 'table';
export const WORK_VIEWS: TWorkView[] = ['cards', 'compact', 'table'];

const STATE_TONES: Record<string, string> = {
  you: 'wait',
  blocked: 'ask',
  running: 'work',
  parked: 'idle',
  done: 'ok',
};
const SOON_DAYS = 2;
const COLUMNS: TWorkColumn[] = [
  'code',
  'title',
  'stage',
  'state',
  'holder',
  'steps',
  'pr',
  'tokens',
  'due',
  'updated',
];
const NUMBER_COLUMNS = new Set<TWorkColumn>(['steps', 'tokens']);
const TOKENS = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });

const Pair = (props: { label: string; children: ReactNode }) => (
  <>
    <span className="c-k">{props.label}</span>
    <span className="c-v">{props.children}</span>
  </>
);

const Progress = (props: { done: number; total: number; label: string }) => (
  <span className="c-v c-mini">
    <Bar done={props.done} total={props.total} />
    <span className="num">{`${props.done}/${props.total}`}</span> {props.label}
  </span>
);

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
    <span className={`c-badge b-${STATE_TONES[view.flow.state]}`}>
      {view.noWork ? t('nw.chip') : t(BoardTables.STAGES[view.flow.cur])}
    </span>
  );
};

const staleTip = (opts: { t: TTranslate }): string =>
  `${opts.t('it.staleTip')} ${BoardUiConstants.STALE_HOURS}${opts.t(' giờ')}`;

const Stale = () => {
  const { t } = useUi();

  return (
    <span className="c-badge b-stale" title={staleTip({ t })}>
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
    'aria-selected': opts.selected,
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
            <b
              className={pr.ci === 'fail' ? 'bad' : 'good'}
            >{`CI ${t(pr.ci === 'fail' ? 'lỗi' : 'đạt')}`}</b>
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
const ItemCard = (props: IRowProps & { card: IItemCard }) => {
  const { t, now } = useUi();
  const { view, card } = props;
  const { flow } = view;
  const clock = (iso: string): string => BoardTime.clock({ iso });
  const pick = usePick({ id: flow.id, selected: props.selected, onSelect: props.onSelect });

  return (
    <div className={`c-card row${props.selected ? ' sel' : ''}`} role="button" {...pick}>
      <div className="c-head">
        <Stage view={view} />
        <span className="c-id">{flow.id}</span>
        {flow.tracker ? <span className="c-ref">{flow.tracker}</span> : null}
        {BoardWork.isStale({ flow, now }) ? <Stale /> : null}
        {view.newCount > 0 ? (
          <span className="unread" title={`${view.newCount}${t(' sự kiện mới')}`} />
        ) : null}
        <span className="c-grow" />
        <Due due={flow.due} />
      </div>
      <div className="c-title">{flow.title}</div>
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
            <PrList prs={card.prs} />
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
        {card.waiting ? (
          <Pair label={t('it.waiting')}>
            <span className="c-wait">{card.waiting}</span>
          </Pair>
        ) : null}
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
        <span className="c-r">
          {t('it.latest')} <b>{clock(view.last.ts)}</b>
        </span>
      </div>
    </div>
  );
};

/** How long ago the flow's newest line was. */
const Updated = (props: { view: IFlowView }) => {
  const { t, now } = useUi();
  const last = BoardWork.lastAt({ flow: props.view.flow });

  return (
    <time className="c-ago" dateTime={last} title={BoardTime.clock({ iso: last })}>
      {BoardTime.ago({ iso: last, now, translate: t })}
    </time>
  );
};

/** One line per flow: code, title, stage, steps and when it last moved. */
const CompactRow = (props: IRowProps) => {
  const { t, now } = useUi();
  const { view } = props;
  const steps = BoardCards.itemOf({ view }).steps;
  const pick = usePick({ id: view.flow.id, selected: props.selected, onSelect: props.onSelect });

  return (
    <div className={`c-line row${props.selected ? ' sel' : ''}`} role="button" {...pick}>
      <span className="c-id">{view.flow.id}</span>
      <span className="c-lt" title={view.flow.title}>
        {view.flow.title}
      </span>
      <span className="c-lm">
        {BoardWork.isStale({ flow: view.flow, now }) ? <Stale /> : null}
        <Stage view={view} />
      </span>
      <span className="c-ls num" title={t('fl.steps')}>
        {steps.total > 0 ? `${steps.done}/${steps.total}` : ''}
      </span>
      <Updated view={view} />
    </div>
  );
};

/** The groups of the list, by who the work waits on; each a card or a line per flow. */
const Groups = (props: {
  views: IFlowView[];
  compact: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
}) => {
  const { t } = useUi();

  return (
    <>
      {BoardTables.GROUPS.map((group) => {
        const items = props.views
          .filter((view) => view.flow.state === group.key)
          .sort((left, right) =>
            group.key === 'you' || group.key === 'blocked'
              ? left.last.ts.localeCompare(right.last.ts)
              : right.last.ts.localeCompare(left.last.ts),
          );
        const open = props.open[group.key] ?? group.open;

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
              <span>{t(group.label)}</span>
              <span className="c-n num">{items.length}</span>
            </button>
            {open && items.length === 0 ? (
              <p className="c-empty">
                {group.key === 'you' ? t('Không có gì chờ anh.') : t('Trống.')}
              </p>
            ) : null}
            {open
              ? items.map((view) =>
                  props.compact ? (
                    <CompactRow
                      key={view.flow.id}
                      view={view}
                      selected={props.selected === view.flow.id}
                      onSelect={props.onSelect}
                    />
                  ) : (
                    <ItemCard
                      key={view.flow.id}
                      view={view}
                      card={BoardCards.itemOf({ view })}
                      selected={props.selected === view.flow.id}
                      onSelect={props.onSelect}
                    />
                  ),
                )
              : null}
          </section>
        );
      })}
    </>
  );
};

/** One row of the table; a cell with nothing to say is empty. */
const TableRow = (props: IRowProps) => {
  const { t, now } = useUi();
  const { view } = props;
  const { flow } = view;
  const card = BoardCards.itemOf({ view });
  const tokens = BoardWork.tokensOf({ flow });
  const pick = usePick({ id: flow.id, selected: props.selected, onSelect: props.onSelect });

  return (
    <tr className={`row${props.selected ? ' sel' : ''}`} {...pick}>
      <td className="c-id">{flow.id}</td>
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
        <span className="t-state">
          <span
            className="c-dot"
            style={{
              background: BoardTables.GROUPS.find((group) => group.key === flow.state)?.swatch,
            }}
          />
          {t(BoardTables.STATE_TEXT[flow.state])}
        </span>
      </td>
      <td className="t-who">{view.holder}</td>
      <td className="num">
        {card.steps.total > 0 ? `${card.steps.done}/${card.steps.total}` : ''}
      </td>
      <td>{card.prs.length > 0 ? <PrList prs={card.prs} /> : null}</td>
      <td className="num" title={tokens === undefined ? undefined : tokens.toLocaleString('en-US')}>
        {tokens === undefined ? '' : TOKENS.format(tokens)}
      </td>
      <td className="num">{flow.due ?? ''}</td>
      <td>
        <Updated view={view} />
      </td>
    </tr>
  );
};

const WorkTable = (props: {
  views: IFlowView[];
  selected: string | null;
  onSelect: (id: string) => void;
}) => {
  const { t } = useUi();
  const [sort, setSort] = useState<TWorkSort>(undefined);
  const rows = BoardWork.sortOf({ views: props.views, sort });
  const sortBy = (column: TWorkColumn): void =>
    setSort(
      sort?.column === column
        ? { column, descending: !sort.descending }
        : { column, descending: column === 'updated' || column === 'tokens' },
    );

  return (
    <div className="t-wrap">
      <table className="t-work">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort?.column === column;
              let order: 'ascending' | 'descending' | undefined;

              if (active) {
                order = sort.descending ? 'descending' : 'ascending';
              }

              return (
                <th
                  key={column}
                  scope="col"
                  aria-sort={order}
                  className={NUMBER_COLUMNS.has(column) ? 'num' : undefined}
                >
                  <button type="button" data-column={column} onClick={() => sortBy(column)}>
                    {t(`col.${column}`)}
                    <SortArrow order={order} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((view) => (
            <TableRow
              key={view.flow.id}
              view={view}
              selected={props.selected === view.flow.id}
              onSelect={props.onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** The filters over every view: the agent (the one picked on the left), the repository, the state, stale only. */
const Filters = (props: {
  views: IFlowView[];
  agents: string[];
  filter: IWorkFilter;
  onFilter: (filter: IWorkFilter) => void;
  staleCount: number;
}) => {
  const { t } = useUi();
  const { filter } = props;
  const repos = BoardWork.reposOf({ views: props.views });
  const any =
    filter.agent !== null || filter.repo !== null || filter.state !== null || filter.staleOnly;
  const select = (opts: {
    label: string;
    value: string | null;
    options: { value: string; text: string }[];
    onChange: (value: string | null) => void;
  }) => (
    <label className="c-field">
      <span>{opts.label}</span>
      <select
        value={opts.value ?? ''}
        onChange={(event) => opts.onChange(event.currentTarget.value || null)}
      >
        <option value="">{t('ft.all')}</option>
        {opts.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="c-tools" role="group" aria-label={t('ft.label')}>
      {select({
        label: t('ft.agent'),
        value: filter.agent,
        options: props.agents.map((name) => ({ value: name, text: name })),
        onChange: (agent) => props.onFilter({ ...filter, agent }),
      })}
      {repos.length > 0
        ? select({
            label: t('ft.repo'),
            value: filter.repo,
            options: repos.map((repo) => ({ value: repo, text: repo })),
            onChange: (repo) => props.onFilter({ ...filter, repo }),
          })
        : null}
      {select({
        label: t('ft.state'),
        value: filter.state,
        options: BoardStates.ORDER.map((state) => ({
          value: state,
          text: t(BoardTables.STATE_TEXT[state]),
        })),
        onChange: (state) => props.onFilter({ ...filter, state }),
      })}
      <button
        className="btn"
        type="button"
        aria-pressed={filter.staleOnly}
        title={staleTip({ t })}
        onClick={() => props.onFilter({ ...filter, staleOnly: !filter.staleOnly })}
      >
        {t('it.stale')} <span className="c-n num">{props.staleCount}</span>
      </button>
      {any ? (
        <button
          className="btn btn-text"
          type="button"
          onClick={() => props.onFilter({ agent: null, repo: null, state: null, staleOnly: false })}
        >
          {t('ft.clear')}
        </button>
      ) : null}
    </div>
  );
};

/** The middle pane: the work, as cards, compact lines or a table, under the same filters. */
export const ItemPane = (props: {
  views: IFlowView[];
  agents: string[];
  agent: string | null;
  onAgent: (name: string | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
  view: TWorkView;
  onView: (view: TWorkView) => void;
}) => {
  const { t, now } = useUi();
  const [rest, setRest] = useState<Omit<IWorkFilter, 'agent'>>({
    repo: null,
    state: null,
    staleOnly: false,
  });
  const filter: IWorkFilter = { ...rest, agent: props.agent };
  const all = BoardWork.listOf({
    views: props.views,
    filter: { agent: null, repo: null, state: null, staleOnly: false },
    now,
  });
  const shown = BoardWork.listOf({ views: props.views, filter, now });
  const loose = props.views.find(
    (view) =>
      view.flow.id === BoardConstants.UNSORTED &&
      (props.agent === null || BoardView.involves({ view, name: props.agent })),
  );
  const onFilter = (next: IWorkFilter): void => {
    const { agent, ...others } = next;

    setRest(others);

    if (agent !== props.agent) {
      props.onAgent(agent);
    }
  };
  let body: ReactNode = null;

  if (all.length === 0) {
    body = (
      <p className="c-empty">
        {t('Chưa có luồng nào. Bật events.log, hoặc ghi một dòng bằng vulcan event add.')}
      </p>
    );
  } else if (shown.length === 0) {
    body = <p className="c-empty">{t('ft.none')}</p>;
  } else if (props.view === 'table') {
    body = <WorkTable views={shown} selected={props.selected} onSelect={props.onSelect} />;
  } else {
    body = (
      <Groups
        views={shown}
        compact={props.view === 'compact'}
        selected={props.selected}
        onSelect={props.onSelect}
        open={props.open}
        onToggle={props.onToggle}
      />
    );
  }

  return (
    <section className="c-pane c-items" aria-label={t('Danh sách luồng')}>
      <div className="c-ph">
        <h2>{t('pn.items')}</h2>
        <span className="c-n num" id="flowN">
          {shown.length}
        </span>
        <span className="c-grow" />
        <div className="seg" role="group" aria-label={t('vw.label')}>
          {WORK_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              data-view={view}
              aria-pressed={props.view === view}
              onClick={() => props.onView(view)}
            >
              {t(`vw.${view}`)}
            </button>
          ))}
        </div>
      </div>
      {all.length === 0 ? null : (
        <Filters
          views={all}
          agents={props.agents}
          filter={filter}
          onFilter={onFilter}
          staleCount={all.filter((view) => BoardWork.isStale({ flow: view.flow, now })).length}
        />
      )}
      <div className="c-scroll" id="groups">
        {body}
        {loose ? (
          <button
            className="c-loose"
            type="button"
            aria-pressed={props.selected === loose.flow.id}
            onClick={() => props.onSelect(loose.flow.id)}
          >
            {`${t('it.unsorted')} · ${loose.evs.length}`}
          </button>
        ) : null}
      </div>
    </section>
  );
};
