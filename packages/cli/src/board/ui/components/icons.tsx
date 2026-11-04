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
