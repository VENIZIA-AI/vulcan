import { ProjectTheme, Theme } from '../visualize/theme.ts';
import type { IThemeInput } from '../visualize/theme.ts';

/** One mode of the token set: token name to colour (`#rrggbb`, or `#rrggbbaa` for a line or a muted text). */
export type TTokenMode = Record<string, string>;

/** What the project writes under `theme`: a preset, an accent, per-token overrides and the type and corner settings. */
export interface IThemeConfig extends Partial<IThemeInput> {
  preset?: string;
  /** A colour for both modes, or one per mode. */
  tokens?: Record<string, string | { light?: string; dark?: string }>;
  font?: string;
  mono?: string;
  radius?: string;
}

/** The resolved set every consumer reads: both modes and the three settings, with the preset it started from. */
export interface IThemeTokens {
  preset: string;
  light: TTokenMode;
  dark: TTokenMode;
  font: string;
  mono: string;
  radius: string;
}

export type TTokensResult = { ok: true; tokens: IThemeTokens } | { ok: false; problems: string[] };

interface IPreset {
  /** The accent the preset is known by; a project that gives the same seed gets the preset as written. */
  seed: IThemeInput;
  light: TTokenMode;
  dark: TTokenMode;
}

/** The neutral part shared by the presets: grounds, text, lines and the states. Board and wiki agree on these values. */
const NEUTRAL_LIGHT: TTokenMode = {
  ground: '#f5f5f5',
  bg: '#ffffff',
  line: '#0000001a',
  'line-strong': '#101010',
  ink: '#000000',
  body: '#4b4b4b',
  muted: '#6b6b6b',
  ok: '#067647',
  'ok-soft': '#e7f5ee',
  wait: '#8a4b00',
  'wait-soft': '#fdf1dc',
  fail: '#b42318',
  'fail-soft': '#fdecea',
  info: '#175cd3',
  'info-soft': '#eff8ff',
};
const NEUTRAL_DARK: TTokenMode = {
  ground: '#121214',
  bg: '#1b1b1b',
  line: '#ffffff1a',
  'line-strong': '#ffffff4d',
  ink: '#ffffff',
  body: '#ffffffb3',
  muted: '#ffffff8c',
  ok: '#47cd89',
  'ok-soft': '#14291f',
  wait: '#fdb022',
  'wait-soft': '#33270f',
  fail: '#f97066',
  'fail-soft': '#3a1d1a',
  info: '#84caff',
  'info-soft': '#102a43',
};

/** The text pairs checked at 4.5:1 and the marks at 3:1, per mode; `on` names the token the first sits on. */
const TEXT_PAIRS: [string, string][] = [
  ['ink', 'bg'],
  ['body', 'bg'],
  ['muted', 'bg'],
  ['ink', 'ground'],
  ['body', 'ground'],
  ['muted', 'ground'],
  ['accent-text', 'bg'],
  ['accent-text', 'ground'],
  ['accent-text', 'accent-soft'],
  ['accent-ink', 'accent'],
  ['ok', 'ok-soft'],
  ['wait', 'wait-soft'],
  ['fail', 'fail-soft'],
  ['info', 'info-soft'],
];
const MARK_PAIRS: [string, string][] = [
  ['accent', 'bg'],
  ['accent', 'ground'],
  ['ok', 'bg'],
  ['wait', 'bg'],
  ['fail', 'bg'],
  ['info', 'bg'],
];
const TEXT_RATIO = 4.5;
const MARK_RATIO = 3;

/** The design tokens: fixed semantic names, values from a preset and the project, checked against WCAG AA. */
export class ThemeTokens {
  static readonly DEFAULT_PRESET = 'venizia';

  /** A colour of a token: six hex digits, or eight with an alpha channel (a line, a soft text). */
  static readonly COLOUR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

  static readonly PRESETS: Record<string, IPreset> = {
    venizia: {
      seed: ProjectTheme.DEFAULT,
      light: {
        ...NEUTRAL_LIGHT,
        accent: '#8a5a20',
        'accent-ink': '#ffffff',
        'accent-soft': '#f5ecdf',
        'accent-text': '#8a5a20',
      },
      dark: {
        ...NEUTRAL_DARK,
        accent: '#dead6a',
        'accent-ink': '#1a1200',
        'accent-soft': '#33281a',
        'accent-text': '#dead6a',
      },
    },
    slate: {
      seed: { accent: '#3f5266', accentDark: '#9fb4cc' },
      light: NEUTRAL_LIGHT,
      dark: NEUTRAL_DARK,
    },
  };

  static readonly FONT = "'Inter Display', system-ui, -apple-system, 'Segoe UI', sans-serif";
  static readonly MONO =
    "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
  static readonly RADIUS = '4px';

  /** The names a project may override: the keys of a preset. */
  static names(): string[] {
    return Object.keys(ThemeTokens.PRESETS.venizia.light);
  }

  /** A colour with an alpha channel laid over `ground`, as the six-digit colour the eye sees. */
  private static opaque(opts: { color: string; ground: string }): string {
    if (opts.color.length !== 9) {
      return opts.color;
    }

    const alpha = Number.parseInt(opts.color.slice(7), 16) / 255;
    const channel = (from: number): number =>
      Math.round(
        Number.parseInt(opts.color.slice(from, from + 2), 16) * alpha +
          Number.parseInt(opts.ground.slice(from, from + 2), 16) * (1 - alpha),
      );

    return `#${[1, 3, 5].map((from) => channel(from).toString(16).padStart(2, '0')).join('')}`;
  }

  private static ratio(opts: { mode: TTokenMode; text: string; on: string }): number {
    const ground = ThemeTokens.opaque({ color: opts.mode[opts.on], ground: opts.mode.bg });

    return Theme.contrastOf({
      foreground: ThemeTokens.opaque({ color: opts.mode[opts.text], ground }),
      background: ground,
    });
  }

  /** Every pair of a mode below AA, each as a sentence that names the pair, the colours and the ratio. */
  private static contrastProblems(opts: { name: string; mode: TTokenMode }): string[] {
    const problems: string[] = [];

    for (const [pairs, needed, role] of [
      [TEXT_PAIRS, TEXT_RATIO, 'text'],
      [MARK_PAIRS, MARK_RATIO, 'a mark'],
    ] as const) {
      for (const [text, on] of pairs) {
        const ratio = ThemeTokens.ratio({ mode: opts.mode, text, on });

        if (ratio < needed) {
          problems.push(
            `${opts.name}: ${text} ${opts.mode[text]} as ${role} on ${on} ${opts.mode[on]} is ${ratio.toFixed(2)}:1; it needs ${needed}:1`,
          );
        }
      }
    }

    return problems;
  }

  /**
   * The token set of a project's `theme` (or of the default preset when it has none): the preset as written, the
   * accent family derived when the project gives its own accent, then its per-token overrides. Every pair is checked
   * for each mode and a pair below AA refuses the whole theme; nothing is swapped for another colour.
   */
  static resolve(opts: { theme?: IThemeConfig }): TTokensResult {
    const theme = opts.theme ?? {};
    const presetName = theme.preset ?? ThemeTokens.DEFAULT_PRESET;
    const preset = Object.hasOwn(ThemeTokens.PRESETS, presetName)
      ? ThemeTokens.PRESETS[presetName]
      : undefined;

    if (preset === undefined) {
      return {
        ok: false,
        problems: [
          `theme preset '${presetName}' is unknown; use one of ${Object.keys(ThemeTokens.PRESETS).join(', ')}`,
        ],
      };
    }

    if (
      theme.accent === undefined &&
      (theme.accentDark !== undefined || theme.accentText !== undefined)
    ) {
      return {
        ok: false,
        problems: ['theme accentDark and accentText belong to an accent: give accent too'],
      };
    }

    const light: TTokenMode = { ...preset.light };
    const dark: TTokenMode = { ...preset.dark };
    const seed: IThemeInput =
      theme.accent === undefined
        ? preset.seed
        : { accent: theme.accent, accentDark: theme.accentDark, accentText: theme.accentText };
    const own =
      seed.accent === preset.seed.accent &&
      seed.accentDark === preset.seed.accentDark &&
      seed.accentText === undefined;

    // Venizia carries its accent family as written; any other seed is derived by the page resolver, which refuses a bad one.
    if (!own || presetName !== 'venizia') {
      const derived = ProjectTheme.resolve({ project: seed });

      if (!derived.ok) {
        return { ok: false, problems: derived.problems };
      }

      for (const [mode, palette] of [
        [light, derived.theme.light],
        [dark, derived.theme.dark],
      ] as const) {
        mode.accent = palette.accent;
        mode['accent-ink'] = palette.accentInk;
        mode['accent-soft'] = palette.accentSoft;
        mode['accent-text'] = palette.accent;
      }

      // On the light ground the page resolver's accent is the text colour; the mark and the fill are the seed itself.
      light.accent = seed.accent;
    }

    const problems: string[] = [];

    for (const [name, value] of Object.entries(theme.tokens ?? {})) {
      if (!Object.hasOwn(light, name)) {
        problems.push(
          `theme token '${name}' is unknown; use one of ${ThemeTokens.names().join(', ')}`,
        );
        continue;
      }

      const given = typeof value === 'string' ? { light: value, dark: value } : value;

      for (const [mode, key] of [
        [light, 'light'],
        [dark, 'dark'],
      ] as const) {
        const color = given[key];

        if (color === undefined) {
          continue;
        }

        if (!ThemeTokens.COLOUR.test(color)) {
          problems.push(`theme token '${name}' ${key} '${color}' is not a hex colour like #8a5a20`);
          continue;
        }

        mode[name] = color.toLowerCase();
      }
    }

    problems.push(
      ...ThemeTokens.contrastProblems({ name: 'light', mode: light }),
      ...ThemeTokens.contrastProblems({ name: 'dark', mode: dark }),
    );

    if (problems.length > 0) {
      return { ok: false, problems };
    }

    return {
      ok: true,
      tokens: {
        preset: presetName,
        light,
        dark,
        font: theme.font ?? ThemeTokens.FONT,
        mono: theme.mono ?? ThemeTokens.MONO,
        radius: theme.radius ?? ThemeTokens.RADIUS,
      },
    };
  }
}
