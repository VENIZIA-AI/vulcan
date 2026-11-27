import { useMemo } from 'react';
import { BoardTables } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardCards } from '../state/cards.ts';
import { BoardWork, WORK_COLUMNS } from '../state/work.ts';
import type { TWorkColumn, TWorkSort } from '../state/work.ts';
import { Chevron, SortArrow, StatusMark } from './icons.tsx';
import { ItemCard, CompactRow, TableRow } from './item-rows.tsx';

const NUMBER_COLUMNS = new Set<TWorkColumn>(['read', 'written']);

/** The groups of the list, by who the work waits on; each a card or a line per flow. */
export const Groups = (props: {
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

export const WorkTable = (props: {
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
