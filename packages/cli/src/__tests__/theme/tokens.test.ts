import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/schema.ts';
import { ThemeTokens } from '../../theme/index.ts';
import { ProjectTheme } from '../../visualize/theme.ts';
import { WikiTheme } from '../../../../../docs/wiki/site/.vitepress/theme/shared/wiki-theme.ts';

const ROOT = join(import.meta.dir, '../../../../..');
const WIKI = join(ROOT, 'docs/wiki/site/.vitepress/theme');
const TOKENS_CSS = readFileSync(join(WIKI, 'shared/tokens.css'), 'utf8');

/** The `--name: value` declarations of the block that opens at `marker` (up to its closing brace). */
const declarations = (opts: {
  css: string;
  marker: string;
  from?: number;
}): Record<string, string> => {
  const open = opts.css.indexOf(opts.marker, opts.from ?? 0);
  const body = opts.css.slice(opts.css.indexOf('{', open) + 1);
  const block = body.slice(0, body.indexOf('}'));

  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*([^;]+?);/g)].map((match) => [match[1], match[2].trim()]),
  );
};

const venizia = ThemeTokens.PRESETS.venizia;

describe('the wiki takes the venizia palette from the manifest theme, value for value', () => {
  const LIGHT: Record<string, string> = {
    bg: '#ffffff',
    surface: '#ffffff',
    stroke: '#0000001a',
    'stroke-strong': '#101010',
    'text-title': '#000000',
    'text-body': '#4b4b4b',
    'text-muted': '#6b6b6b',
    accent: '#8a5a20',
    'accent-ink': '#ffffff',
    'accent-text': '#8a5a20',
    'accent-on-dark': '#dead6a',
    'accent-2': '#c48a5a',
  };
  const DARK: Record<string, string> = {
    bg: '#121214',
    surface: '#1b1b1b',
    stroke: '#ffffff1a',
    'stroke-strong': '#ffffff4d',
    'text-title': '#ffffff',
    'text-body': '#ffffffb3',
    'text-muted': '#ffffff8c',
    accent: '#dead6a',
    'accent-ink': '#1a1200',
    'accent-text': '#dead6a',
  };
  const css = WikiTheme.css({ theme: venizia, accent2: '#c48a5a' });

  test('the generated blocks hold the values the wiki held before it read the manifest', () => {
    const light = declarations({ css, marker: ':root{' });
    const dark = declarations({ css, marker: '.dark{' });

    for (const [name, value] of Object.entries(LIGHT)) {
      expect(light[name], `light ${name}`).toBe(value);
    }

    for (const [name, value] of Object.entries(DARK)) {
      expect(dark[name], `dark ${name}`).toBe(value);
    }

    expect(light.glow).toBe('color-mix(in srgb, var(--accent) 13%, transparent)');
    expect(dark.glow).toBe('color-mix(in srgb, var(--accent) 16%, transparent)');
  });

  test('the committed manifest carries the same theme, and shared tokens.css declares none of these', () => {
    const fromManifest = WikiTheme.read({ manifest: join(ROOT, '.agents/vulcan.manifest.json') });
    const declared = declarations({ css: TOKENS_CSS, marker: ':root {' });

    expect(WikiTheme.css({ theme: fromManifest, accent2: '#c48a5a' })).toBe(css);

    for (const name of Object.keys(LIGHT)) {
      expect(declared[name], `tokens.css declares --${name}`).toBeUndefined();
    }
  });

  test('a manifest with no theme is an error that says what to run', () => {
    const path = join(tmpdir(), `wiki-theme-${process.pid}.json`);

    writeFileSync(path, '{}');
    expect(() => WikiTheme.read({ manifest: path })).toThrow('vulcan sync');
    rmSync(path);
  });

  test('a theme that lacks a token is refused, naming it', () => {
    expect(() => WikiTheme.css({ theme: { light: { bg: '#fff' }, dark: {} } })).toThrow('has no');
  });
});

describe('ThemeTokens.resolve', () => {
  test('no theme is the venizia preset as written, in both modes', () => {
    const result = ThemeTokens.resolve({});

    expect(result.ok && result.tokens.preset).toBe('venizia');
    expect(result.ok && result.tokens.light).toEqual(venizia.light);
    expect(result.ok && result.tokens.dark).toEqual(venizia.dark);
    expect(result.ok && result.tokens.radius).toBe('4px');
  });

  test('both presets pass every contrast pair, and slate changes only the accent family', () => {
    const slate = ThemeTokens.resolve({ theme: { preset: 'slate' } });

    expect(slate.ok).toBe(true);
    expect(slate.ok && slate.tokens.light.ink).toBe(venizia.light.ink);
    expect(slate.ok && slate.tokens.light.accent).toBe('#3f5266');
    expect(slate.ok && slate.tokens.dark.accent).toBe('#9fb4cc');
  });

  test("the preset's own seeds keep the preset as written; another accent is derived", () => {
    const own = ThemeTokens.resolve({ theme: { accent: '#8a5a20', accentDark: '#dead6a' } });
    const other = ThemeTokens.resolve({ theme: { accent: '#336699' } });

    expect(own.ok && own.tokens.light['accent-soft']).toBe('#f5ecdf');
    expect(other.ok && other.tokens.light.accent).toBe('#336699');
    expect(other.ok && other.tokens.light['accent-soft']).not.toBe('#f5ecdf');
    expect(other.ok && other.tokens.light.ink).toBe(venizia.light.ink);
  });

  test('every preset passes its own check, and each text colour is read on the accent tint', () => {
    for (const name of Object.keys(ThemeTokens.PRESETS)) {
      const result = ThemeTokens.resolve({ theme: { preset: name } });

      expect(!result.ok && result.problems, name).toBe(false);
    }

    // ink, body and muted sit on the tint of a selected card: slate's derived tint (#e8eaed) fails muted at 4.42:1.
    const faint = ThemeTokens.resolve({
      theme: { tokens: { 'accent-soft': { light: '#e0e0e0' }, muted: { light: '#6b6b6b' } } },
    });

    expect(
      !faint.ok &&
        faint.problems.some((problem) => problem.includes('muted #6b6b6b as text on accent-soft')),
    ).toBe(true);
  });

  test('a custom accent on the slate preset gets the derived tint, not the preset one', () => {
    const custom = ThemeTokens.resolve({ theme: { preset: 'slate', accent: '#336699' } });

    expect(custom.ok && custom.tokens.light['accent-soft']).not.toBe(
      ThemeTokens.PRESETS.slate.light['accent-soft'],
    );
  });

  test('a per-token override applies, to both modes or to one', () => {
    const result = ThemeTokens.resolve({
      theme: {
        tokens: { 'line-strong': '#808080', body: { light: '#333333' }, ok: { dark: '#3ddc97' } },
        radius: '8px',
      },
    });

    expect(result.ok && result.tokens.light['line-strong']).toBe('#808080');
    expect(result.ok && result.tokens.dark['line-strong']).toBe('#808080');
    expect(result.ok && result.tokens.light.body).toBe('#333333');
    expect(result.ok && result.tokens.dark.body).toBe(venizia.dark.body);
    expect(result.ok && result.tokens.dark.ok).toBe('#3ddc97');
    expect(result.ok && result.tokens.light.ok).toBe(venizia.light.ok);
    expect(result.ok && result.tokens.radius).toBe('8px');
  });

  test('a pair below AA is refused, naming the pair, the colours and the ratio', () => {
    const result = ThemeTokens.resolve({ theme: { tokens: { muted: { light: '#cccccc' } } } });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]).toMatch(
      /^light: muted #cccccc as text on bg #ffffff is 1\.61:1; it needs 4\.5:1$/,
    );
  });

  test('a mark below 3:1 and a line with alpha are judged on the ground they sit on', () => {
    const mark = ThemeTokens.resolve({ theme: { tokens: { fail: { light: '#ffb4ab' } } } });
    const alpha = ThemeTokens.resolve({ theme: { tokens: { muted: { dark: '#ffffff40' } } } });

    expect(
      !mark.ok && mark.problems.some((problem) => problem.includes('fail #ffb4ab as a mark')),
    ).toBe(true);
    expect(
      !alpha.ok && alpha.problems.some((problem) => problem.startsWith('dark: muted #ffffff40')),
    ).toBe(true);
  });

  test('a name that is only on the prototype is not a preset or a token', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(ThemeTokens.resolve({ theme: { preset: name } }).ok, name).toBe(false);
      expect(ThemeTokens.resolve({ theme: { tokens: { [name]: '#ffffff' } } }).ok, name).toBe(
        false,
      );
      expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: { preset: name } }).success, name).toBe(false);
    }
  });

  test('the accent as text is checked on the ground and on its own tint, not only on bg', () => {
    const result = ThemeTokens.resolve({
      theme: { tokens: { 'accent-text': { light: '#767676' } } },
    });

    expect(result.ok).toBe(false);
    expect(
      !result.ok &&
        result.problems.some((problem) =>
          /accent-text #767676 as text on (ground|accent-soft)/.test(problem),
        ),
    ).toBe(true);
  });

  test('a dark or text accent without its accent is refused, not ignored', () => {
    expect(ThemeTokens.resolve({ theme: { accentDark: '#dead6a' } }).ok).toBe(false);
    expect(ThemeTokens.resolve({ theme: { preset: 'slate', accentText: '#254a73' } }).ok).toBe(
      false,
    );
  });

  test('the preset accent given alone is derived, as visualize derives it, so both agree on the dark accent', () => {
    const result = ThemeTokens.resolve({ theme: { accent: '#8a5a20' } });
    const page = ProjectTheme.resolve({ project: { accent: '#8a5a20' } });

    expect(result.ok && page.ok && result.tokens.dark.accent).toBe(
      page.ok && page.theme.dark.accent,
    );
  });

  test('an unknown preset, an unknown token and a value that is not a colour are refused', () => {
    expect(ThemeTokens.resolve({ theme: { preset: 'neon' } }).ok).toBe(false);
    expect(ThemeTokens.resolve({ theme: { tokens: { glow: '#ffffff' } } }).ok).toBe(false);
    expect(ThemeTokens.resolve({ theme: { tokens: { ink: 'black' } } }).ok).toBe(false);
  });
});

describe('the config refuses a theme below AA when it loads', () => {
  test('the issue names the pair; a good theme and an empty one load', () => {
    const bad = VULCAN_CONFIG_SCHEMA.safeParse({
      theme: { tokens: { body: { dark: '#202020' } } },
    });
    const good = VULCAN_CONFIG_SCHEMA.safeParse({ theme: { preset: 'slate', radius: '2px' } });

    expect(bad.success).toBe(false);
    expect(!bad.success && bad.error.issues[0].message).toContain('dark: body #202020');
    expect(good.success).toBe(true);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: {} }).success).toBe(true);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: { preset: 'neon' } }).success).toBe(false);
  });
});
