import { ThemeModes } from '../common/index.ts';
import type { TThemeMode } from '../common/index.ts';
import { readParentDocument } from './frame.ts';

type TPalette = Record<string, string>;

const FALLBACK_PALETTES: Record<TThemeMode, TPalette> = {
  [ThemeModes.LIGHT]: {
    bg: '#ffffff',
    'bg-soft': '#f7f7f9',
    'bg-alt': '#eeeef1',
    text: '#1c2128',
    'text-2': '#636b74',
    border: '#e3e3e8',
    brand: '#3b5bdb',
  },
  [ThemeModes.DARK]: {
    bg: '#16161a',
    'bg-soft': '#1c1c21',
    'bg-alt': '#121215',
    text: '#e7e7e3',
    'text-2': '#9b9ba4',
    border: '#2a2a30',
    brand: '#a8b1ff',
  },
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The page palette: the embedding VitePress wiki's variables when framed, the OS scheme alone. */
export class VizTheme {
  private static dark = true;

  static isDark(): boolean {
    return this.dark;
  }

  /** `hsl` per section, evenly spread around the wheel; lighter on dark backgrounds. Comma syntax: Cytoscape rejects the space form. */
  static getSectionColor(opts: { index: number; total: number }): string {
    const hue = Math.round((opts.index / opts.total) * 360);

    return `hsl(${hue}, 62%, ${this.dark ? 62 : 46}%)`;
  }

  static readVariable(opts: { name: string }): string {
    return getComputedStyle(document.documentElement).getPropertyValue(opts.name).trim();
  }

  static apply(): void {
    const root = document.documentElement;
    const palette = this.readWikiPalette() ?? this.readSystemPalette();

    for (const [name, value] of Object.entries(palette)) {
      if (value) {
        root.style.setProperty(`--${name}`, value);
      }
    }

    root.style.setProperty('color-scheme', this.dark ? ThemeModes.DARK : ThemeModes.LIGHT);
  }

  static watch(opts: { onChange: () => void }): void {
    const reapply = (): void => {
      this.apply();
      opts.onChange();
    };

    matchMedia(DARK_QUERY).addEventListener('change', reapply);

    const parentDocument = readParentDocument();

    if (parentDocument) {
      new MutationObserver(reapply).observe(parentDocument.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  private static readSystemPalette(): TPalette {
    this.dark = matchMedia(DARK_QUERY).matches;

    return FALLBACK_PALETTES[this.dark ? ThemeModes.DARK : ThemeModes.LIGHT];
  }

  private static readWikiPalette(): TPalette | undefined {
    const parentDocument = readParentDocument();

    if (!parentDocument) {
      return undefined;
    }

    const styles = getComputedStyle(parentDocument.documentElement);
    const read = (name: string): string => styles.getPropertyValue(name).trim();
    const background = read('--vp-c-bg');

    if (!background) {
      return undefined;
    }

    this.dark = parentDocument.documentElement.classList.contains('dark');

    const root = document.documentElement;
    const font = read('--vp-font-family-base');

    if (font) {
      root.style.setProperty('--font', font);
    }

    const monoFont = read('--vp-font-family-mono');

    if (monoFont) {
      root.style.setProperty('--mono', monoFont);
    }

    return {
      bg: background,
      'bg-soft': read('--vp-c-bg-soft') || background,
      'bg-alt': read('--vp-c-bg-alt') || background,
      text: read('--vp-c-text-1'),
      'text-2': read('--vp-c-text-2'),
      border: read('--vp-c-divider'),
      brand: read('--vp-c-brand-1') || read('--vp-c-brand'),
    };
  }
}
