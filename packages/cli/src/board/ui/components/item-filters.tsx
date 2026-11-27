import { BoardStates } from '../../common/index.ts';
import { BoardTables } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardWork } from '../state/work.ts';
import type { IWorkFilter } from '../state/work.ts';
import { ICONS } from './icons.tsx';

/** Where the filters open as a modal sheet; the same width as the page's phone rules. */
const PHONE = '(max-width: 640px)';

/** The filters over every view: the agent (the one picked on the left), the repository, the state, stale only. */
export const Filters = (props: {
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
        title={BoardWork.staleTip({ t })}
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
