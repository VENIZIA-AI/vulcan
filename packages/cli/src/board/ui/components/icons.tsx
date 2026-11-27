import type { TSortOrder } from '../common/types.ts';

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;

/** The three themes, drawn as the button that switches them. */
export const THEME_ICONS = {
  light: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="3.6" {...STROKE} />
      <path
        d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"
        {...STROKE}
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z"
        {...STROKE}
        strokeLinejoin="round"
      />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" {...STROKE} />
      <path d="M7 17h6M10 13.5V17" {...STROKE} strokeLinecap="round" />
    </svg>
  ),
};

export const Chevron = () => (
  <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.5l3 3 3-3" {...STROKE} />
  </svg>
);

/** The order of a sorted column; two faint arrows on a column that is not sorted. */
export const SortArrow = (props: { order: TSortOrder | undefined }) => (
  <svg className={`sort${props.order ? ' on' : ''}`} viewBox="0 0 10 12" aria-hidden="true">
    {props.order === 'descending' ? null : <path d="M2.5 5 5 2.5 7.5 5" {...STROKE} />}
    {props.order === 'ascending' ? null : <path d="M2.5 7 5 9.5 7.5 7" {...STROKE} />}
  </svg>
);

const ICON = { viewBox: '0 0 16 16', 'aria-hidden': true } as const;

/** The small line icons of the bar and the toolbar, drawn on a 16px grid. */
export const ICONS = {
  eye: (
    <svg {...ICON}>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" {...STROKE} />
      <circle cx="8" cy="8" r="2" {...STROKE} />
    </svg>
  ),
  more: (
    <svg {...ICON}>
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  ),
  filter: (
    <svg {...ICON}>
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" {...STROKE} strokeLinecap="round" />
    </svg>
  ),
  cards: (
    <svg {...ICON}>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" {...STROKE} />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" {...STROKE} />
    </svg>
  ),
  compact: (
    <svg {...ICON}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" {...STROKE} strokeLinecap="round" />
    </svg>
  ),
  table: (
    <svg {...ICON}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" {...STROKE} />
      <path d="M2.5 6.5h11M2.5 10h11M6.5 6.5v7" {...STROKE} />
    </svg>
  ),
  down: (
    <svg {...ICON} className="dn">
      <path d="M5 6.5 8 9.5l3-3" {...STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/** Where a flow is, as a shape as well as a colour: waiting, blocked, running, parked, done. */
export const StatusMark = (props: { state: string }) => (
  <svg className={`sm s-${props.state}`} viewBox="0 0 14 14" aria-hidden="true">
    {props.state === 'you' ? (
      <>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
      </>
    ) : null}
    {props.state === 'blocked' ? (
      <rect x="2.2" y="2.2" width="9.6" height="9.6" rx="2" fill="currentColor" />
    ) : null}
    {props.state === 'running' ? (
      <>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 3.2a3.8 3.8 0 0 1 0 7.6Z" fill="currentColor" />
      </>
    ) : null}
    {props.state === 'parked' ? (
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.2 2"
      />
    ) : null}
    {props.state === 'done' ? (
      <>
        <circle cx="7" cy="7" r="6.2" fill="currentColor" />
        <path
          d="m4.4 7.2 1.8 1.8 3.4-3.6"
          fill="none"
          stroke="var(--bg)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ) : null}
  </svg>
);
