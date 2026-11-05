import { RecordValue } from '../common/record.ts';
import { OkfProjectConstants } from '../project/index.ts';
import { ThemeModes } from './common/index.ts';
import type { TThemeMode, TVizPalette } from './common/index.ts';

/** `value[key]` when `value` is an object, else undefined. */
const fieldOf = (opts: { value: unknown; key: string }): unknown =>
  RecordValue.isRecord(opts) ? opts.value[opts.key] : undefined;

/** The colours of the explorer page, taken from the `theme` tokens of the project manifest that `vulcan x` hands okf. */
export class VizPalette {
  /** Each custom property of the page and the design token that fills it. */
  static readonly TOKEN_OF: Record<string, string> = {
    bg: 'ground',
    'bg-soft': 'bg',
    'bg-alt': 'ground',
    text: 'ink',
    'text-2': 'muted',
    border: 'line',
    brand: 'accent-text',
    'brand-ink': 'accent-ink',
  };

  /** The palette of each mode; throws when the manifest or a token is missing, since okf keeps no page colour of its own. */
  static read(): Record<TThemeMode, TVizPalette> {
    const text = process.env[OkfProjectConstants.MANIFEST_ENV];
    const manifest: unknown = text === undefined ? undefined : JSON.parse(text);
    const tokens = fieldOf({ value: fieldOf({ value: manifest, key: 'theme' }), key: 'tokens' });
    const modeOf = (mode: TThemeMode): TVizPalette => {
      const palette: TVizPalette = {};

      for (const [property, token] of Object.entries(VizPalette.TOKEN_OF)) {
        const colour = fieldOf({ value: fieldOf({ value: tokens, key: mode }), key: token });

        if (typeof colour !== 'string') {
          throw new Error(
            `okf: the manifest has no ${mode} theme token '${token}' for the explorer - run okf through \`vulcan x\``,
          );
        }

        palette[property] = colour;
      }

      return palette;
    };

    return {
      [ThemeModes.LIGHT]: modeOf(ThemeModes.LIGHT),
      [ThemeModes.DARK]: modeOf(ThemeModes.DARK),
    };
  }
}
