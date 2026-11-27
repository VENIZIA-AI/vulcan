import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BoardConstants } from '../../common/index.ts';
import type { IFlowView, TWorkView } from '../common/types.ts';
import { usePopover } from '../app/hooks.ts';
import { useUi } from '../i18n/context.ts';
import { BoardView } from '../state/view.ts';
import { BoardWork } from '../state/work.ts';
import type { IWorkFilter, TWorkSort } from '../state/work.ts';
import { ICONS } from './icons.tsx';
import { Filters } from './item-filters.tsx';
import { Groups, WorkTable } from './item-lists.tsx';

export const WORK_VIEWS: TWorkView[] = ['cards', 'compact', 'table'];

const VIEW_ICONS: Record<TWorkView, ReactNode> = {
  cards: ICONS.cards,
  compact: ICONS.compact,
  table: ICONS.table,
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
