import { Locales } from '../common/index.ts';
import type { TLocale } from '../common/index.ts';
import { readParentDocument } from './frame.ts';

/** The explorer's own interface text; project prose comes from the page data instead. */
export interface IUiStrings {
  search: string;
  start: string;
  related: string;
  source: string;
  none: string;
  mapHint: string;
  concepts: string;
  areas: string;
  formatResults: (opts: { count: number }) => string;
  formatMore: (opts: { count: number }) => string;
}

export const UI_STRINGS: Record<TLocale, IUiStrings> = {
  [Locales.EN]: {
    search: 'Search the knowledge…',
    start: 'Project knowledge',
    related: 'Related',
    source: 'Source',
    none: 'No matches.',
    mapHint: 'Drag to pan · scroll to zoom · click a node to read it',
    concepts: 'concepts',
    areas: 'areas',
    formatResults: opts => `${opts.count} result${opts.count === 1 ? '' : 's'}`,
    formatMore: opts => `+ ${opts.count} more`,
  },
  [Locales.VI]: {
    search: 'Tìm trong kiến thức…',
    start: 'Kiến thức dự án',
    related: 'Liên quan',
    source: 'Nguồn',
    none: 'Không có kết quả.',
    mapHint: 'Kéo để di chuyển · cuộn để zoom · click vào node để đọc',
    concepts: 'khái niệm',
    areas: 'lĩnh vực',
    formatResults: opts => `${opts.count} kết quả`,
    formatMore: opts => `+ ${opts.count} nữa`,
  },
};

/** `?lang=` wins; otherwise a `/vi/` path - the embedding wiki's when framed, this page's alone. */
export const resolveLocale = (): TLocale => {
  const requested = new URLSearchParams(location.search).get('lang');

  if (requested !== null && Locales.isValid(requested)) {
    return requested === Locales.VI ? Locales.VI : Locales.EN;
  }

  const pathname = readParentDocument()?.location.pathname ?? location.pathname;

  return /\/vi(\/|$)/.test(pathname) ? Locales.VI : Locales.EN;
};
