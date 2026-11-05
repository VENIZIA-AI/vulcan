import { ThemeModes } from '../common/index.ts';
import type { TThemeMode, TVizPalette } from '../common/index.ts';
import { ParentFrame } from './frame.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The page palette: the embedding VitePress wiki's variables when framed, else the project's theme tokens in the mode the OS asks for. */
export class VizTheme {
  private static dark = true;
  private static palettes: Record<TThemeMode, TVizPalette> | undefined;

  /** The project's palette of each mode, from the page data; call it before `apply`. */
  static configure(opts: { palettes: Record<TThemeMode, TVizPalette> }): void {
    this.palettes = opts.palettes;
  }

  static isDark(): boolean {
    return this.dark;
  }

  /** `hsl` per section, evenly spread around the wheel; lighter on dark backgrounds. Comma syntax: Cytoscape rejects the space form. */
  static getSectionColor(opts: { index: number; total: number }): string {
    const hue = Math.round((opts.index / opts.total) * 360);

    return `hsl(${hue}, 62%, ${this.dark ? 62 : 46}%)`;
  }

  /**
   * The colour of a custom property as an opaque `rgb()`, laid over the page background when it has an alpha channel.
   * Cytoscape reads neither the eight-digit hex of a token nor the alpha of an `rgba()`: it draws the colour solid.
   */
  static readVariable(opts: { name: string }): string {
    const [red, green, blue, alpha] = this.channelsOf({ name: opts.name });
    const [baseRed, baseGreen, baseBlue] = this.channelsOf({ name: '--bg' });
    const mix = (colour: number, base: number): number =>
      Math.round(colour * alpha + base * (1 - alpha));

    return `rgb(${mix(red, baseRed)}, ${mix(green, baseGreen)}, ${mix(blue, baseBlue)})`;
  }

  /** Red, green, blue and alpha of a custom property, as the browser computes the colour. */
  private static channelsOf(opts: { name: string }): [number, number, number, number] {
    const value = getComputedStyle(document.documentElement).getPropertyValue(opts.name).trim();
    const probe = document.createElement('span');

    probe.style.color = value;
    document.body.append(probe);

    const [red = 0, green = 0, blue = 0, alpha = 1] = (
      getComputedStyle(probe).color.match(/[\d.]+/g) ?? []
    ).map(Number);

    probe.remove();

    return [red, green, blue, alpha];
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

    const parentDocument = ParentFrame.readDocument();

    if (parentDocument) {
      new MutationObserver(reapply).observe(parentDocument.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  private static readSystemPalette(): TVizPalette {
    this.dark = matchMedia(DARK_QUERY).matches;

    return this.palettes?.[this.dark ? ThemeModes.DARK : ThemeModes.LIGHT] ?? {};
  }

  private static readWikiPalette(): TVizPalette | undefined {
    const parentDocument = ParentFrame.readDocument();

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
      'brand-ink': read('--vp-button-brand-text') || background,
    };
  }
}
