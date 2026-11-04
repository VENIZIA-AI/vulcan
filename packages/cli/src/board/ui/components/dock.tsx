import { useRef } from 'react';
import { BoardStateWords } from '../common/constants.ts';
import type { IAgentRow } from '../common/types.ts';
import { useReplay } from '../hooks.ts';
import { useUi } from '../i18n/context.ts';
import { BoardTime } from '../state/time.ts';
import { BoardFace, Face } from './face.tsx';

const Cell = (props: {
  row: IAgentRow;
  shape: string;
  open: boolean;
  onOpen: (name: string, anchor: Element) => void;
}) => {
  const { t, now } = useUi();
  const { row } = props;
  const cell = useRef<HTMLButtonElement>(null);
  const ticker = useRef<HTMLSpanElement>(null);
  const word = t(BoardStateWords.WORD[row.st]);

  useReplay({ ref: cell, trigger: row.st, className: 'shake', when: row.st === 'blocked' });
  useReplay({ ref: cell, trigger: row.key, className: 'hop' });
  useReplay({ ref: ticker, trigger: row.key, className: 'in' });

  return (
    <button
      ref={cell}
      className={`cell ${row.st}${row.st === 'idle' ? ' compact' : ''}`}
      type="button"
      data-agent={row.n}
      aria-haspopup="dialog"
      aria-expanded={props.open}
      title={`${row.n} · ${word}${row.flow ? ` · ${row.flow}` : ''} · ${row.text}`}
      aria-label={`${row.n}, ${word}${row.flow ? `${t(', luồng ')}${row.flow}` : ''}. ${row.text}`}
      onClick={(event) => props.onOpen(row.n, event.currentTarget)}
    >
      <span className="fw">
        <Face
          state={row.st}
          tint={BoardFace.tintOf({ name: row.n })}
          name={row.n}
          shape={props.shape}
        />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="nm">
          <b>{row.n}</b>
          <span className="fc" hidden={!row.flow}>
            {row.flow ?? ''}
          </span>
        </span>
        <span ref={ticker} className="tk">
          <span className="tx">{row.text}</span>
        </span>
        <span className="ft">
          <span className={`spill ${row.st}`}>{t(BoardStateWords.PILL[row.st])}</span>
          <span className="ag">
            {row.ts
              ? `${row.approx ? '≈ ' : ''}${BoardTime.ago({ iso: row.ts, now, translate: t })}`
              : ''}
          </span>
          <span className="hp">
            {row.helpers
              ? `+${row.helpers} ${t(row.helpers === 1 ? 'n.helper' : 'n.helpers')}`
              : ''}
          </span>
        </span>
      </span>
    </button>
  );
};

/** The bar of agents along the bottom: a face, what it is doing and since when; a click opens its card. */
export const Dock = (props: {
  rows: IAgentRow[];
  owner: string;
  shapes: Record<string, string>;
  popFor: string | null;
  onOpen: (name: string, anchor: Element) => void;
}) => {
  const { t } = useUi();
  const count = (state: string): number => props.rows.filter((row) => row.st === state).length;
  const summary = (
    [
      ['working', ' đang làm'],
      ['you', ' chờ anh'],
      ['blocked', ' bị chặn'],
      ['idle', ' rảnh'],
    ] as const
  )
    .filter(([state]) => count(state) > 0)
    .map(([state, word]) => `${count(state)}${t(word)}`)
    .join(' · ');

  return (
    <footer className="dock" id="dock" aria-label={t('Các agent đang chạy')}>
      <div className="dock-lbl">
        <b id="dockN">{`${props.rows.length} ${t('n.agents')}`}</b>
        <span id="dockSum">{summary || t('chưa có agent')}</span>
      </div>
      {props.rows.map((row) => (
        <Cell
          key={row.n}
          row={row}
          shape={BoardFace.shapeOf({ name: row.n, owner: props.owner, shapes: props.shapes })}
          open={props.popFor === row.n}
          onOpen={props.onOpen}
        />
      ))}
    </footer>
  );
};
