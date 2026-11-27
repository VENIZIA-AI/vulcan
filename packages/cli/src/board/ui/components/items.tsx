import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BoardConstants, BoardStates } from '../../common/index.ts';
import { BoardTables, BoardUiConstants } from '../common/constants.ts';
import type { IFlowView, TTranslate } from '../common/types.ts';
import { usePopover } from '../app/hooks.ts';
import { useUi } from '../i18n/context.ts';
import { BoardCards } from '../state/cards.ts';
import type { IItemCard } from '../state/cards.ts';
import { BoardTime } from '../state/time.ts';
import { BoardView } from '../state/view.ts';
import { BoardWork, WORK_COLUMNS } from '../state/work.ts';
import type { IWorkFilter, TWorkColumn, TWorkSort } from '../state/work.ts';
import { Mark } from './bits.tsx';
import { BoardFace } from './face.tsx';
import { Chevron, ICONS, SortArrow, StatusMark } from './icons.tsx';

export type TWorkView = 'cards' | 'compact' | 'table';
export const WORK_VIEWS: TWorkView[] = ['cards', 'compact', 'table'];

const SOON_DAYS = 2;
/** Where the filters open as a modal sheet; the same width as the page's phone rules. */
const PHONE = '(max-width: 640px)';
/** Up to this many steps a bar draws one segment each; more draw as one bar. */
const SEGMENTS_MAX = 12;
const NUMBER_COLUMNS = new Set<TWorkColumn>(['read', 'written']);
const TOKENS = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
const VIEW_ICONS: Record<TWorkView, ReactNode> = {
  cards: ICONS.cards,
  compact: ICONS.compact,
  table: ICONS.table,
};

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
const ItemCard = (props: IRowProps & { card: IItemCard }) => {
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
const CompactRow = (props: IRowProps) => {
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
              ? BoardWork.updatedAt({ view: left }).localeCompare(
                  BoardWork.updatedAt({ view: right }),
                )
              : BoardWork.updatedAt({ view: right }).localeCompare(
                  BoardWork.updatedAt({ view: left }),
                ),
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
              <StatusMark state={group.key} />
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
const TableRow = (props: IRowProps) => {
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

const WorkTable = (props: {
  views: IFlowView[];
  selected: string | null;
  onSelect: (id: string) => void;
  sort: TWorkSort;
  onSort: (sort: TWorkSort) => void;
}) => {
  const { t } = useUi();
  const { sort } = props;
  const rows = useMemo(() => BoardWork.sortOf({ views: props.views, sort }), [props.views, sort]);
  const sortBy = (column: TWorkColumn): void => props.onSort(BoardWork.nextSort({ sort, column }));

  return (
    <div className="t-wrap">
      <table className="t-work">
        <colgroup>
          {WORK_COLUMNS.map((column) => (
            <col key={column} className={`w-${column}`} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {WORK_COLUMNS.map((column) => {
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
  open: boolean;
  onClose: () => void;
  panel: { current: HTMLDivElement | null };
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
    <label className={`c-field pill${opts.value === null ? '' : ' on'}`}>
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
      {ICONS.down}
    </label>
  );

  return (
    <div
      ref={props.panel}
      className={`c-tools${props.open ? ' open' : ''}`}
      role={props.open ? 'dialog' : 'group'}
      aria-modal={props.open && matchMedia(PHONE).matches ? true : undefined}
      aria-label={t('ft.label')}
    >
      <div className="sheet-head">
        <b>{t('ft.label')}</b>
        <button className="btn-text" type="button" onClick={props.onClose}>
          {t('ft.done')}
        </button>
      </div>
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
        className="pill stale-pill"
        type="button"
        aria-pressed={filter.staleOnly}
        title={staleTip({ t })}
        onClick={() => props.onFilter({ ...filter, staleOnly: !filter.staleOnly })}
      >
        {t('it.stale')} <b className="num">{props.staleCount}</b>
      </button>
      {any ? (
        <button
          className="btn-text"
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
  sort: TWorkSort;
  onSort: (sort: TWorkSort) => void;
}) => {
  const { t, now } = useUi();
  const [rest, setRest] = useState<Omit<IWorkFilter, 'agent'>>({
    repo: null,
    state: null,
    staleOnly: false,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filter: IWorkFilter = { ...rest, agent: props.agent };
  const active =
    [filter.agent, filter.repo, filter.state].filter((value) => value !== null).length +
    Number(filter.staleOnly);
  const fButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closeFilters = (): void => {
    setFiltersOpen(false);
    fButton.current?.focus();
  };
  const all = useMemo(
    () =>
      BoardWork.listOf({
        views: props.views,
        filter: { agent: null, repo: null, state: null, staleOnly: false },
        now,
      }),
    [props.views, now],
  );
  const shown = useMemo(
    () => BoardWork.listOf({ views: props.views, filter, now }),
    [props.views, now, filter.agent, filter.repo, filter.state, filter.staleOnly],
  );
  const staleCount = useMemo(
    () => all.filter((view) => BoardWork.isStale({ flow: view.flow, now })).length,
    [all, now],
  );

  usePopover({
    open: filtersOpen,
    panel: sheet,
    trigger: fButton,
    onClose: closeFilters,
    trap: true,
  });
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
        {t('Chưa có luồng nào. Bật board.events.log, hoặc ghi một dòng bằng vulcan event add.')}
      </p>
    );
  } else if (shown.length === 0) {
    body = <p className="c-empty">{t('ft.none')}</p>;
  } else if (props.view === 'table') {
    body = (
      <WorkTable
        views={shown}
        selected={props.selected}
        onSelect={props.onSelect}
        sort={props.sort}
        onSort={props.onSort}
      />
    );
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
      <div className="c-ph c-bar2">
        <h2>{t('pn.items')}</h2>
        <span className="c-n num" id="flowN">
          {shown.length}
        </span>
        <div className="seg" role="group" aria-label={t('vw.label')}>
          {WORK_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              data-view={view}
              aria-pressed={props.view === view}
              aria-label={t(`vw.${view}`)}
              title={t(`vw.${view}`)}
              onClick={() => props.onView(view)}
            >
              {VIEW_ICONS[view]}
              <span className="lbl">{t(`vw.${view}`)}</span>
            </button>
          ))}
        </div>
        {all.length === 0 ? null : (
          <>
            <button
              ref={fButton}
              className={`pill f-btn${active > 0 ? ' on' : ''}`}
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              {ICONS.filter}
              {t('ft.label')}
              {active > 0 ? <b className="num">{active}</b> : null}
            </button>
            <Filters
              views={all}
              agents={props.agents}
              filter={filter}
              onFilter={onFilter}
              staleCount={staleCount}
              open={filtersOpen}
              onClose={closeFilters}
              panel={sheet}
            />
            {filtersOpen ? (
              <div className="scrim" aria-hidden="true" onClick={closeFilters} />
            ) : null}
          </>
        )}
      </div>
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
