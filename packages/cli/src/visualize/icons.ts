/** Inline SVG icons, 24 by 24, drawn in `currentColor`: the page loads no icon font and no image. */
const PATHS: Record<string, string> = {
  done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  progress:
    '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  blocked: '<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z"/><path d="M9 9l6 6M15 9l-6 6"/>',
  notstarted: '<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 3.2"/>',
  dropped: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  verified:
    '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  inferred: '<path d="M3 15c3-6 5-6 9 0s6 6 9 0"/>',
  guess:
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  quote: '<path d="M9 7H5v6h4l-2 4M19 7h-4v6h4l-2 4"/>',
  star: '<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
};

export const iconSvg = (opts: { name: string; size?: number }): string => {
  const size = opts.size ?? 20;

  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[opts.name] ?? ''}</svg>`;
};
