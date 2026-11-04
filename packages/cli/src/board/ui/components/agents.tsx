import type { ReactNode } from 'react';
import { BoardStateWords } from '../common/constants.ts';
import type { IAgentRow } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardLatest } from '../state/latest.ts';
import type { IAgentCard } from '../state/cards.ts';
import { BoardTime } from '../state/time.ts';
import { BoardFace, Face } from './face.tsx';

/** The colour of a state's badge. */
export const AGENT_TONES: Record<string, string> = {
  you: 'ask',
  blocked: 'ask',
  working: 'work',
  idle: 'idle',
};

const Pair = (props: { label: string; children: ReactNode }) => (
  <>
    <span className="c-k">{props.label}</span>
    <span className="c-v">{props.children}</span>
  </>
);

/** One agent: who it is, what it is doing now, what it said last, and how busy it was. A click filters the work to it. */
const AgentCard = (props: {
  row: IAgentRow;
  card: IAgentCard;
  shape: string;
  picked: boolean;
  onPick: (name: string) => void;
}) => {
  const { t, now } = useUi();
  const { row, card } = props;
  const clock = (iso: string): string => BoardTime.clock({ iso });
  const who = [card.role, card.harness, card.model].filter(Boolean).join(' · ');
  const since = card.since ? ` · ${BoardTime.ago({ iso: card.since, now, translate: t })}` : '';

  return (
    <div
      className={`c-card cell ${row.st}${props.picked ? ' sel' : ''}`}
      data-agent={row.n}
      role="button"
      tabIndex={0}
      aria-pressed={props.picked}
      onClick={() => props.onPick(row.n)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onPick(row.n);
        }
      }}
    >
      <div className="c-head">
        <span className="c-face">
          <Face
            state={row.st}
            tint={BoardFace.tintOf({ name: row.n })}
            name={row.n}
            shape={props.shape}
          />
        </span>
        <div className="c-grow">
          <div className="c-nm">{row.n}</div>
          {who ? <div className="c-role">{who}</div> : null}
        </div>
        <span
          className={`c-badge b-${AGENT_TONES[row.st]}`}
        >{`${t(BoardStateWords.PILL[row.st])}${since}`}</span>
      </div>
      <div className="c-body">
        {card.workingOn ? (
          <Pair label={t('ag.working')}>
            {card.workingOn.flow.title} <small>{card.workingOn.flow.id}</small>
          </Pair>
        ) : null}
        {row.ask ? <Pair label={t('ag.asking')}>{`"${row.ask}"`}</Pair> : null}
        {card.action ? (
          <Pair label={t(card.workingOn ? 'ag.action' : 'ag.lastTime')}>
            {card.action.summary} <small>{clock(card.action.ts)}</small>
          </Pair>
        ) : null}
        {card.message ? (
          <Pair label={t('ag.message')}>
            {BoardLatest.textOf({ event: card.message, translate: t })}{' '}
            <small>{clock(card.message.ts)}</small>
          </Pair>
        ) : null}
      </div>
      <div className="c-foot">
        <span>
          {t('ag.prs')} <b>{card.prs}</b>
        </span>
        <span>
          {t('ag.pending')} <b>{card.pending}</b>
        </span>
        <span>
          <b>{card.today}</b> {t('ag.today')}
        </span>
        {row.helpers > 0 ? (
          <span>{`+${row.helpers} ${t(row.helpers === 1 ? 'n.helper' : 'n.helpers')}`}</span>
        ) : null}
        {card.last ? <span className="c-r">{clock(card.last)}</span> : null}
      </div>
    </div>
  );
};

/** The left pane: the agents, each a card. */
export const AgentPane = (props: {
  rows: IAgentRow[];
  cards: Record<string, IAgentCard>;
  owner: string;
  shapes: Record<string, string>;
  picked: string | null;
  onPick: (name: string) => void;
}) => {
  const { t } = useUi();

  return (
    <section className="c-pane" id="dock" aria-label={t('Các agent đang chạy')}>
      <div className="c-ph">
        {t('pn.agents')} <span className="c-n">{props.rows.length}</span>
      </div>
      <div className="c-scroll">
        {props.rows.length === 0 ? <p className="c-empty">{t('chưa có agent')}</p> : null}
        {props.rows.map((row) => (
          <AgentCard
            key={row.n}
            row={row}
            card={props.cards[row.n]}
            shape={BoardFace.shapeOf({ name: row.n, owner: props.owner, shapes: props.shapes })}
            picked={props.picked === row.n}
            onPick={props.onPick}
          />
        ))}
      </div>
    </section>
  );
};
