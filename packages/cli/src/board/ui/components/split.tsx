import { useRef } from 'react';
import { useT } from '../i18n/context.ts';

const MIN = 25;
const MAX = 75;
export const SPLIT_DEFAULT = 58;

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
const EDGES: Record<string, number> = { Home: MIN, End: MAX };

const clamp = (value: number): number => Math.max(MIN, Math.min(MAX, Math.round(value)));

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
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={props.percent}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const box = props.area()?.getBoundingClientRect();

        if (dragging.current && box) {
          props.onChange(clamp(((event.clientX - box.left) / box.width) * 100), false);
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
          props.onChange(clamp(to), true);
        }
      }}
    />
  );
};
