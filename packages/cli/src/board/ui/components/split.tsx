import { useRef } from 'react';
import { useT } from '../i18n/context.ts';

/** How far the bar may go, where it starts, and what a stored or dragged value becomes. */
export class BoardSplit {
  static readonly MIN = 25;
  static readonly MAX = 75;
  static readonly DEFAULT = 58;

  static clamp(opts: { percent: number }): number {
    return Math.max(BoardSplit.MIN, Math.min(BoardSplit.MAX, Math.round(opts.percent)));
  }
}

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
const EDGES: Record<string, number> = { Home: BoardSplit.MIN, End: BoardSplit.MAX };

/** The bar between the flow list and the detail: drag it, or use the arrow keys, Home and End. */
export const Split = (props: {
  percent: number;
  onChange: (percent: number, save: boolean) => void;
  onReset: () => void;
  area: () => HTMLElement | null;
}) => {
  const t = useT();
  const dragging = useRef(false);
  return (
    <div
      className={`split${dragging.current ? ' drag' : ''}`}
      id="split"
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={t('split')}
      aria-valuemin={BoardSplit.MIN}
      aria-valuemax={BoardSplit.MAX}
      aria-valuenow={props.percent}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const box = props.area()?.getBoundingClientRect();

        if (dragging.current && box) {
          props.onChange(
            BoardSplit.clamp({ percent: ((event.clientX - box.left) / box.width) * 100 }),
            false,
          );
        }
      }}
      onPointerUp={() => {
        dragging.current = false;
        props.onChange(props.percent, true);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onDblClick={props.onReset}
      onKeyDown={(event) => {
        const to =
          EDGES[event.key] ?? props.percent + (ARROWS[event.key] ?? 0) * (event.shiftKey ? 10 : 2);

        if (event.key in ARROWS || event.key in EDGES) {
          event.preventDefault();
          props.onChange(BoardSplit.clamp({ percent: to }), true);
        }
      }}
    />
  );
};
