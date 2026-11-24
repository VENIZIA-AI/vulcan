import { z } from 'zod';
import { ThemeTokens } from '../../../theme/index.ts';
import { ProjectTheme } from '../../../visualize/theme.ts';

/** A colour of a design token: six-digit hex, or eight-digit with an alpha channel for lines and soft text. */
const TOKEN_COLOUR = z.string().regex(ThemeTokens.COLOUR, 'a hex colour like #8a5a20');

export const THEME_SECTION = {
  /**
   * The colour the project is known by: `vulcan page new` takes the accent of its pages from here (the spec's own
   * `accent` wins). `accent` is the colour for marks and fills; `accentDark` is the same on dark grounds (derived
   * when absent); `accentText` is a darker accent for text, when `accent` is too light to be read as text.
   * `vulcan project sync` copies it to the manifest, where the generator reads it.
   */
  theme: z
    .strictObject({
      /** The preset the tokens start from: `venizia` (default) or `slate`; a preset fixes every token and the project changes only what it names. */
      preset: z
        .string()
        .refine((name) => Object.hasOwn(ThemeTokens.PRESETS, name), {
          message: `one of ${Object.keys(ThemeTokens.PRESETS).join(', ')}`,
        })
        .optional(),
      /** Colour for marks and fills, as a six-digit hex such as `#8a5a20`; absent means the preset's accent. */
      accent: z.string().regex(ProjectTheme.HEX, 'a six-digit hex colour like #8a5a20').optional(),
      /** Accent for dark grounds, a six-digit hex such as `#dead6a`; derived from `accent` when absent. */
      accentDark: z
        .string()
        .regex(ProjectTheme.HEX, 'a six-digit hex colour like #dead6a')
        .optional(),
      /** Darker accent for text, a six-digit hex such as `#01579b`; absent means `accent` is used for text too. */
      accentText: z
        .string()
        .regex(ProjectTheme.HEX, 'a six-digit hex colour like #01579b')
        .optional(),
      /** Per-token colours over the preset, keyed by token name: one hex for both modes, or `{ light, dark }`; each pair is checked against WCAG AA. */
      tokens: z
        .record(
          z.string(),
          z.union([
            TOKEN_COLOUR,
            z.strictObject({ light: TOKEN_COLOUR.optional(), dark: TOKEN_COLOUR.optional() }),
          ]),
        )
        .optional(),
      /** The sans font stack for the board, the wiki and the pages; default the preset's. */
      font: z.string().min(1).optional(),
      /** The monospace font stack; default the preset's. */
      mono: z.string().min(1).optional(),
      /** The corner radius: `0`, or a number with `px`, `rem` or `em` such as `4px`; anything else is refused. Default the preset's. */
      radius: z.string().min(1).optional(),
    })
    .superRefine((theme, context) => {
      const resolved = ThemeTokens.resolve({ theme });

      if (!resolved.ok) {
        for (const message of resolved.problems) {
          context.addIssue({ code: 'custom', message, path: [] });
        }
      }
    })
    .optional(),
};
