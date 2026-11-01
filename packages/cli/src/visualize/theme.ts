import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What a project (or one spec) says about its colour: the colour it is known by, and two optional helpers. */
export interface IThemeInput {
  /** The colour the project is known by: marks, rules and fills. */
  accent: string;
  /** The accent on dark grounds; derived by mixing toward white when absent. */
  accentDark?: string;
  /** The accent as text on light grounds, when `accent` is too light for text. */
  accentText?: string;
}

export type TThemeSource = 'spec' | 'project' | 'default';

/** The colours of one theme, each already checked against the grounds it sits on. */
export interface IThemePalette {
  bg: string;
  bgSoft: string;
  ink: string;
  body: string;
  muted: string;
  /** The accent as text and as a mark on `bg` and `bgSoft`. */
  accent: string;
  /** The text on an accent fill. */
  accentInk: string;
  /** The tint behind an accent. */
  accentSoft: string;
  /** The accent as a mark on the slab. */
  hot: string;
  hotInk: string;
  hotGlow: string;
  slab: string;
  slab2: string;
  slab3: string;
  slabInk: string;
  slabBody: string;
  slabMuted: string;
  slabDot: string;
}

export interface IResolvedTheme {
  source: TThemeSource;
  light: IThemePalette;
  dark: IThemePalette;
  /** What the generator worked out, for the report: nothing is silent. */
  notes: string[];
  warnings: string[];
}

export type TThemeResult = { ok: true; theme: IResolvedTheme } | { ok: false; problems: string[] };

const HEX = /^#[0-9a-fA-F]{6}$/;
/** WCAG: text 4.5 to 1, a mark 3 to 1. */
const TEXT_RATIO = 4.5;
const MARK_RATIO = 3;
const MAX_MIX = 0.6;
const MIX_STEP = 0.05;
/** A state hue the accent must keep away from: the blocked red and the done green of the page. */
const STATE_HUES: { name: string; hue: number }[] = [
  { name: 'blocked', hue: 3 },
  { name: 'done', hue: 141 },
];
const HUE_NEAR = 20;

interface IRgb {
  r: number;
  g: number;
  b: number;
}

const parse = (hex: string): IRgb => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const toHex = (rgb: IRgb): string =>
  `#${[rgb.r, rgb.g, rgb.b]
    .map((value) =>
      Math.round(Math.max(0, Math.min(255, value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** `amount` of `toward` mixed into `base`. */
const mix = (opts: { base: string; toward: string; amount: number }): string => {
  const a = parse(opts.base);
  const b = parse(opts.toward);

  return toHex({
    r: a.r + (b.r - a.r) * opts.amount,
    g: a.g + (b.g - a.g) * opts.amount,
    b: a.b + (b.b - a.b) * opts.amount,
  });
};

const luminance = (hex: string): number => {
  const { r, g, b } = parse(hex);
  const channel = (value: number): number => {
    const scaled = value / 255;

    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export class Theme {
  static contrastOf(opts: { foreground: string; background: string }): number {
    const a = luminance(opts.foreground);
    const b = luminance(opts.background);

    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
}

const hueOf = (hex: string): number => {
  const { r, g, b } = parse(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (max === min) {
    return 0;
  }

  const delta = max - min;
  const hue =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;

  return (hue * 60 + 360) % 360;
};

const hueGap = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;

  return gap > 180 ? 360 - gap : gap;
};

const ratioText = (value: number): string => `${value.toFixed(2)}:1`;

/** The fixed grounds: tinted a little toward the accent, so a page reads as the project's own. */
const GROUNDS = {
  light: { bg: '#ffffff', bgSoft: '#f6f6f5', ink: '#0e0e0f', body: '#3a3a3d', muted: '#66666b' },
  dark: { bg: '#121214', bgSoft: '#1b1b1e', ink: '#f6f6f7', body: '#d0d0d4', muted: '#a2a2a8' },
  slab: {
    slab: '#151517',
    slab2: '#202023',
    slab3: '#2b2b2f',
    ink: '#f5f5f6',
    body: '#d0d0d4',
    muted: '#a2a2a8',
  },
  slabDark: { slab: '#0b0b0c', slab2: '#19191b', slab3: '#252528' },
  accentLightSoft: 0.12,
  accentDarkSoft: 0.14,
  tint: 0.035,
};

export class ProjectTheme {
  /** The colour of a page whose project says nothing: a slate ink. */
  static readonly DEFAULT: IThemeInput = { accent: '#3f5266', accentDark: '#9fb4cc' };

  /** The manifest is read only up to this size: a real one is a few KB. */
  static readonly MAX_MANIFEST_BYTES = 1024 * 1024;

  /** Whether `value` is a six-digit hex colour. */
  static isHex(value: unknown): value is string {
    return typeof value === 'string' && HEX.test(value);
  }

  /**
   * The theme of a page: the spec's own accent, else the project's `theme` from the manifest, else the neutral
   * default. Every text, mark and fill pair is checked; a failure writes nothing and says the colour, the ground
   * and the ratio. A colour is never swapped for another.
   */
  static resolve(opts: { spec?: IThemeInput; project?: IThemeInput }): TThemeResult {
    const source: TThemeSource =
      opts.spec !== undefined ? 'spec' : opts.project !== undefined ? 'project' : 'default';
    const given = opts.spec ?? opts.project ?? ProjectTheme.DEFAULT;
    const problems: string[] = [];
    const notes: string[] = [];
    const warnings: string[] = [];

    for (const [key, value] of Object.entries(given)) {
      if (value !== undefined && !HEX.test(value)) {
        problems.push(`theme ${key} '${value}' is not a six-digit hex colour like #3f5266`);
      }
    }

    if (problems.length > 0) {
      return { ok: false, problems };
    }

    const tint = (base: string, accent: string): string =>
      mix({ base, toward: accent, amount: GROUNDS.tint });
    const lightGrounds = {
      bg: GROUNDS.light.bg,
      bgSoft: tint(GROUNDS.light.bgSoft, given.accent),
    };
    const accentText = given.accentText ?? given.accent;
    const accentSoft = mix({
      base: GROUNDS.light.bg,
      toward: given.accent,
      amount: GROUNDS.accentLightSoft,
    });

    // Light theme: the accent as a mark, then as text on every ground text sits on.
    for (const [name, ground] of [
      ['the page', lightGrounds.bg],
      ['a soft panel', lightGrounds.bgSoft],
    ] as const) {
      const mark = Theme.contrastOf({ foreground: given.accent, background: ground });

      if (mark < MARK_RATIO) {
        problems.push(
          `accent ${given.accent} as a mark on ${name} (${ground}) is ${ratioText(mark)}; a mark needs ${MARK_RATIO}:1`,
        );
      }
    }

    for (const [name, ground] of [
      ['the page', lightGrounds.bg],
      ['a soft panel', lightGrounds.bgSoft],
      ['an accent tint', accentSoft],
    ] as const) {
      const text = Theme.contrastOf({ foreground: accentText, background: ground });

      if (text < TEXT_RATIO) {
        const which = given.accentText === undefined ? 'accent' : 'accentText';

        problems.push(
          `${which} ${accentText} as text on ${name} (${ground}) is ${ratioText(text)}; text needs ${TEXT_RATIO}:1${
            given.accentText === undefined ? ' - give a darker accentText' : ''
          }`,
        );
      }
    }

    // Dark theme and the slab: the dark accent is given, or the accent mixed toward white until it passes.
    const darkGrounds = {
      bg: GROUNDS.dark.bg,
      bgSoft: tint(GROUNDS.dark.bgSoft, given.accent),
    };
    const slabs = [
      GROUNDS.slab.slab,
      GROUNDS.slab.slab2,
      GROUNDS.slab.slab3,
      GROUNDS.slabDark.slab,
    ];
    const darkNeeds = [darkGrounds.bg, darkGrounds.bgSoft, ...slabs];
    const darkPasses = (color: string): boolean =>
      darkNeeds.every(
        (ground) => Theme.contrastOf({ foreground: color, background: ground }) >= TEXT_RATIO,
      );
    let dark = given.accentDark;

    if (dark === undefined) {
      for (let amount = 0; amount <= MAX_MIX + 1e-9; amount += MIX_STEP) {
        const candidate = mix({ base: given.accent, toward: '#ffffff', amount });

        if (darkPasses(candidate)) {
          dark = candidate;
          break;
        }
      }

      if (dark === undefined) {
        problems.push(
          `accent ${given.accent} cannot be made readable on the dark grounds by mixing up to ${Math.round(MAX_MIX * 100)}% white - give an accentDark`,
        );
      } else if (dark !== given.accent) {
        notes.push(
          `accentDark ${dark} derived from ${given.accent} (mixed toward white until it passes ${TEXT_RATIO}:1)`,
        );
      }
    } else {
      for (const ground of darkNeeds) {
        const value = Theme.contrastOf({ foreground: dark, background: ground });

        if (value < TEXT_RATIO) {
          problems.push(
            `accentDark ${dark} on ${ground} is ${ratioText(value)}; text needs ${TEXT_RATIO}:1`,
          );
        }
      }
    }

    if (problems.length > 0 || dark === undefined) {
      return { ok: false, problems };
    }

    const accentInk = ProjectTheme.inkOn({ fill: given.accent });
    const hotInk = ProjectTheme.inkOn({ fill: dark });

    if (accentInk === undefined) {
      problems.push(
        `no black or white text reads at ${TEXT_RATIO}:1 on an accent fill ${given.accent}`,
      );
    }

    if (hotInk === undefined) {
      problems.push(`no black or white text reads at ${TEXT_RATIO}:1 on an accent fill ${dark}`);
    }

    if (problems.length > 0 || accentInk === undefined || hotInk === undefined) {
      return { ok: false, problems };
    }

    const hue = hueOf(given.accent);

    for (const state of STATE_HUES) {
      if (hueGap(hue, state.hue) <= HUE_NEAR) {
        warnings.push(
          `accent ${given.accent} is close in hue to the '${state.name}' colour of the page: state is carried by an icon and a word, but check the page reads clearly`,
        );
      }
    }

    const darkSoft = mix({ base: GROUNDS.dark.bg, toward: dark, amount: GROUNDS.accentDarkSoft });
    const light: IThemePalette = {
      ...GROUNDS.light,
      bgSoft: lightGrounds.bgSoft,
      accent: accentText,
      accentInk,
      accentSoft,
      hot: dark,
      hotInk,
      hotGlow: `${dark}40`,
      slab: tint(GROUNDS.slab.slab, dark),
      slab2: tint(GROUNDS.slab.slab2, dark),
      slab3: tint(GROUNDS.slab.slab3, dark),
      slabInk: GROUNDS.slab.ink,
      slabBody: GROUNDS.slab.body,
      slabMuted: GROUNDS.slab.muted,
      slabDot: '#ffffff14',
    };
    const darkPalette: IThemePalette = {
      ...GROUNDS.dark,
      bgSoft: darkGrounds.bgSoft,
      accent: dark,
      accentInk: hotInk,
      accentSoft: darkSoft,
      hot: dark,
      hotInk,
      hotGlow: `${dark}40`,
      slab: tint(GROUNDS.slabDark.slab, dark),
      slab2: tint(GROUNDS.slabDark.slab2, dark),
      slab3: tint(GROUNDS.slabDark.slab3, dark),
      slabInk: GROUNDS.slab.ink,
      slabBody: GROUNDS.slab.body,
      slabMuted: GROUNDS.slab.muted,
      slabDot: '#ffffff14',
    };

    return { ok: true, theme: { source, light, dark: darkPalette, notes, warnings } };
  }

  /** Black or white, whichever reads at 4.5:1 on a fill; white when both do. */
  static inkOn(opts: { fill: string }): string | undefined {
    const candidates = ['#ffffff', '#0e0e0f'];

    return candidates.find(
      (ink) => Theme.contrastOf({ foreground: ink, background: opts.fill }) >= TEXT_RATIO,
    );
  }

  /** The custom properties of one palette. */
  private static declarations(opts: { palette: IThemePalette }): string {
    const p = opts.palette;

    return [
      `--bg:${p.bg}`,
      `--bg-soft:${p.bgSoft}`,
      `--ink:${p.ink}`,
      `--body:${p.body}`,
      `--muted:${p.muted}`,
      `--accent:${p.accent}`,
      `--accent-ink:${p.accentInk}`,
      `--accent-soft:${p.accentSoft}`,
      `--hot:${p.hot}`,
      `--hot-ink:${p.hotInk}`,
      `--hot-glow:${p.hotGlow}`,
      `--slab:${p.slab}`,
      `--slab-2:${p.slab2}`,
      `--slab-3:${p.slab3}`,
      `--slab-ink:${p.slabInk}`,
      `--slab-body:${p.slabBody}`,
      `--slab-muted:${p.slabMuted}`,
      `--slab-dot:${p.slabDot}`,
    ].join(';');
  }

  /**
   * The theme blocks: light on `:root`, then the system dark setting unless the page was set to light, then an
   * explicit dark. The same tokens in each.
   */
  static tokensCss(opts: { theme: IResolvedTheme }): string {
    const light = ProjectTheme.declarations({ palette: opts.theme.light });
    const dark = ProjectTheme.declarations({ palette: opts.theme.dark });

    return `:root{${light};color-scheme:light}\n@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${dark};color-scheme:dark}}\n:root[data-theme=dark]{${dark};color-scheme:dark}`;
  }

  /**
   * The project's `theme` from the manifest of the folder the command runs in. No config file is loaded and nothing
   * is requested: a missing file, or a manifest with no `theme`, is the neutral default.
   */
  static readManifestTheme(opts: { root: string }): { theme?: IThemeInput; warning?: string } {
    let text: string;

    try {
      const directory = join(opts.root, '.agents');
      const file = join(directory, 'vulcan.manifest.json');
      const folder = lstatSync(directory);
      const entry = lstatSync(file);

      // A symlink (the folder or the file), a device or a huge file is not read: the manifest is a small file inside the project.
      if (
        !folder.isDirectory() ||
        !entry.isFile() ||
        entry.size > ProjectTheme.MAX_MANIFEST_BYTES
      ) {
        return {};
      }

      text = readFileSync(file, 'utf8');
    } catch {
      return {};
    }

    let manifest: unknown;

    try {
      manifest = JSON.parse(text);
    } catch {
      return {
        warning: '.agents/vulcan.manifest.json is not valid JSON, so the neutral colour is used',
      };
    }

    const theme: unknown =
      typeof manifest === 'object' && manifest !== null
        ? Reflect.get(manifest, 'theme')
        : undefined;

    if (theme === undefined) {
      return {};
    }

    if (typeof theme !== 'object' || theme === null) {
      return { warning: 'the manifest theme is not an object, so the neutral colour is used' };
    }

    const accent: unknown = Reflect.get(theme, 'accent');
    const accentDark: unknown = Reflect.get(theme, 'accentDark');
    const accentText: unknown = Reflect.get(theme, 'accentText');

    if (!ProjectTheme.isHex(accent)) {
      return {
        warning: 'the manifest theme has no six-digit hex accent, so the neutral colour is used',
      };
    }

    return {
      theme: {
        accent,
        ...(ProjectTheme.isHex(accentDark) ? { accentDark } : {}),
        ...(ProjectTheme.isHex(accentText) ? { accentText } : {}),
      },
    };
  }
}
