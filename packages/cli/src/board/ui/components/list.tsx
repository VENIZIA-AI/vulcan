import { useEffect, useRef } from 'react';
import { BoardTables } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardTime } from '../state/time.ts';
import { BoardView } from '../state/view.ts';
import { FlowCode, Strip, Untitled } from './bits.tsx';
import { Chevron } from './icons.tsx';

export type TViewMode = 'list' | 'diagram' | 'board';
export const VIEW_MODES: TViewMode[] = ['list', 'diagram', 'board'];

interface IListProps {
  flows: IFlowView[];
  mode: TViewMode;
  onMode: (mode: TViewMode) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  agent: string | null;
  onAgent: (name: string | null) => void;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
}

const Row = (props: { view: IFlowView; selected: boolean; onSelect: (id: string) => void }) => {
  const { t, now } = useUi();
  const { view } = props;
  const { flow } = view;
  const ref = useRef<HTMLDivElement>(null);
  const hot = flow.state === 'you' || flow.state === 'blocked';
  let said = view.last.summary;

  if (view.noWork) {
    said = flow.next ?? flow.why ?? '';
  } else if (flow.state === 'you' && view.lastAsk) {
    said = view.lastAsk.summary;
  }

  useEffect(() => {
    if (props.selected) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [props.selected]);

  return (
    <div
      ref={ref}
      className="row"
      tabIndex={0}
      data-id={flow.id}
      role="button"
      data-comment-target=""
      aria-selected={props.selected}
      onClick={() => props.onSelect(flow.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault();
          props.onSelect(flow.id);
        }
      }}
    >
      {view.newCount > 0 ? (
        <span
          className="unread"
          title={`${view.newCount}${t(' sự kiện mới')}`}
          aria-label={`${view.newCount}${t(' sự kiện mới')}`}
        />
      ) : (
        <span />
      )}
      <FlowCode id={flow.id} />
      <div className="tt">
        <div className="t">{flow.title}</div>
        <div className="sub">
          {view.named ? null : <Untitled />}
          <span className="repo">{flow.repo}</span>
          <span className="last">{said}</span>
        </div>
      </div>
      <Strip view={view} />
      <span className="holder">{view.holder}</span>
      <span
        className={`age${hot ? ' hot' : ''}`}
        title={`${t('Sự kiện cuối lúc ')}${BoardTime.clock({ iso: view.last.ts })}${view.approxLast ? t(' (giờ ước lượng)') : ''}`}
      >
        {view.approxLast ? '≈ ' : ''}
        {BoardTime.ago({ iso: view.last.ts, now, translate: t })}
      </span>
    </div>
  );
};

const Groups = (props: IListProps) => {
  const { t, now } = useUi();
  const today = (view: IFlowView): boolean => BoardTime.isSameDay({ iso: view.last.ts, now });

  if (props.flows.length === 0) {
    return (
      <p className="empty">
        {t('Chưa có luồng nào. Bật events.log, hoặc ghi một dòng bằng vulcan event add.')}
      </p>
    );
  }

  return (
    <>
      {BoardTables.GROUPS.map((group) => {
        const items = props.flows
          .filter(
            (view) =>
              view.flow.state === group.key &&
              (group.key !== 'done' || today(view)) &&
              (props.agent === null || BoardView.involves({ view, name: props.agent })),
          )
          .sort((left, right) =>
            group.key === 'you' || group.key === 'blocked'
              ? BoardView.byTime(left.last, right.last)
              : BoardView.byTime(right.last, left.last),
          );
        const open = props.open[group.key] ?? group.open;

        return (
          <section key={group.key} className="grp">
            <button
              className="gh"
              type="button"
              aria-expanded={open}
              onClick={() => props.onToggle(group.key)}
            >
              <Chevron />
              <span className="sw" style={{ background: group.swatch }} />
              <span>{t(group.label)}</span>
              <span className="n">{items.length}</span>
            </button>
            {open && items.length === 0 ? (
              <p className="empty">
                {group.key === 'you' ? t('Không có gì chờ anh.') : t('Trống.')}
              </p>
            ) : null}
            {open
              ? items.map((view) => (
                  <Row
                    key={view.flow.id}
                    view={view}
                    selected={props.selected === view.flow.id}
                    onSelect={props.onSelect}
                  />
                ))
              : null}
          </section>
        );
      })}
    </>
  );
};

/** The flows by stage, one column each; a flow with no work waits in a column of its own, before the stages. */
const Kanban = (props: IListProps) => {
  const { t, now } = useUi();
  const items = props.flows.filter(
    (view) =>
      (view.flow.state !== 'done' || BoardTime.isSameDay({ iso: view.last.ts, now })) &&
      (props.agent === null || BoardView.involves({ view, name: props.agent })),
  );
  const columns = BoardTables.STAGES.map((name, stage) => ({ name, stage }));

  if (items.some((view) => view.noWork)) {
    columns.unshift({ name: 'nw.chip', stage: -1 });
  }

  return (
    <div className="kb">
      {columns.map(({ name, stage }) => {
        const mine = items
          .filter((view) => (stage < 0 ? view.noWork : view.flow.cur === stage && !view.noWork))
          .sort(
            (left, right) =>
              BoardTables.STATE_ORDER.indexOf(left.flow.state) -
              BoardTables.STATE_ORDER.indexOf(right.flow.state),
          );
        const blocked = mine.filter((view) => view.flow.state === 'blocked').length;
        const waiting = mine.filter((view) => view.flow.state === 'you').length;

        return (
          <section key={name} className="kc">
            <div className="kh">
              <span>{t(name)}</span>
              <span className="n">{mine.length}</span>
              {blocked ? <span className="hot bad">{`${blocked} ${t('kb.block')}`}</span> : null}
              {!blocked && waiting ? (
                <span className="hot">{`${waiting} ${t('kb.wait')}`}</span>
              ) : null}
            </div>
            <div className="kl">
              {mine.length === 0 ? <div className="kempty">{t('kb.empty')}</div> : null}
              {mine.map((view) => (
                <button
                  key={view.flow.id}
                  className={`kcard ${view.flow.state}`}
                  type="button"
                  data-id={view.flow.id}
                  aria-current={props.selected === view.flow.id}
                  onClick={() => props.onSelect(view.flow.id)}
                >
                  <div className="km">
                    <FlowCode id={view.flow.id} />
                    <span className="repo">{view.flow.repo}</span>
                    {view.newCount > 0 ? <span className="unread" /> : null}
                  </div>
                  <div className="kt">
                    {view.flow.title}
                    {view.named ? null : <Untitled />}
                  </div>
                  <div className="km">
                    <span className="holder">{view.holder}</span>
                    <span className="spacer" />
                    <span className={`pill ${view.flow.state}`}>
                      {t(BoardTables.STATE_TEXT[view.flow.state])}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

/** The left pane: the count, the filter chip, the three ways to look, and the flows. */
export const FlowList = (props: IListProps) => {
  const { t } = useUi();

  return (
    <section className="pane list" aria-label={t('Danh sách luồng')}>
      <div className="ph">
        <h2>
          <span>{t('Luồng việc')}</span>
        </h2>
        <span className="n" id="flowN">
          {`${props.flows.length}${t(' luồng')}`}
          {props.agent === null ? null : (
            <>
              {' · '}
              <button
                className="filter-chip"
                type="button"
                aria-label={`${t('Bỏ lọc theo ')}${props.agent}`}
                onClick={() => props.onAgent(null)}
              >
                {t('Của ')}
                <b>{props.agent}</b> ×
              </button>
            </>
          )}
        </span>
        <span className="spacer" />
        <div className="seg" role="radiogroup" id="vmode" aria-label={t('vm.label')}>
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              data-mode={mode}
              aria-checked={props.mode === mode}
              onClick={() => props.onMode(mode)}
            >
              <span>{t(`vm.${mode}`)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pb" id="groups">
        {props.mode === 'board' && props.flows.length > 0 ? (
          <Kanban {...props} />
        ) : (
          <Groups {...props} />
        )}
      </div>
    </section>
  );
};
