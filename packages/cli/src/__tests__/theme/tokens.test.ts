import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/schema.ts';
import { ThemeTokens } from '../../theme/index.ts';

const ROOT = join(import.meta.dir, '../../../../..');
const BOARD = readFileSync(join(ROOT, 'packages/cli/src/board/ui/shell.html'), 'utf8');
const WIKI = join(ROOT, 'docs/wiki/site/.vitepress/theme');
const TOKENS_CSS = readFileSync(join(WIKI, 'shared/tokens.css'), 'utf8');
const PRODUCT_CSS = readFileSync(join(WIKI, 'product.css'), 'utf8');

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

describe('the venizia preset is the palette the board and the wiki hold today', () => {
  test('the board: every shared token has the value of its :root block, light and dark', () => {
    const light = declarations({ css: BOARD, marker: ':root {' });
    const dark = declarations({
      css: BOARD,
      marker: ":root:not([data-theme='light'])",
    });
    const names: Record<string, string> = {
      ground: 'ground',
      bg: 'bg',
      line: 'line',
      'stroke-strong': 'line-strong',
      ink: 'ink',
      body: 'body',
      muted: 'muted',
      accent: 'accent',
      'accent-ink': 'accent-ink',
      'accent-soft': 'accent-soft',
      ok: 'ok',
      'ok-soft': 'ok-soft',
      wait: 'wait',
      'wait-soft': 'wait-soft',
      fail: 'fail',
      'fail-soft': 'fail-soft',
    };

    for (const [board, token] of Object.entries(names)) {
      expect(light[board], `light ${board}`).toBe(venizia.light[token]);
      expect(dark[board], `dark ${board}`).toBe(venizia.dark[token]);
    }
  });

  test('the wiki: text, lines, surfaces and the accent have the same values', () => {
    const colours = declarations({
      css: TOKENS_CSS,
      marker: ':root {',
      from: TOKENS_CSS.indexOf('--bg:') - 20,
    });
    const wikiDark = declarations({ css: TOKENS_CSS, marker: '.dark {' });
    const accent = declarations({ css: PRODUCT_CSS, marker: ':root {' });
    const accentDark = declarations({ css: PRODUCT_CSS, marker: '.dark {' });
    const light: Record<string, string> = {
      'text-title': 'ink',
      'text-body': 'body',
      'text-muted': 'muted',
      stroke: 'line',
      'stroke-strong': 'line-strong',
      bg: 'bg',
    };
    const dark: Record<string, string> = {
      'text-title': 'ink',
      'text-body': 'body',
      'text-muted': 'muted',
      stroke: 'line',
      'stroke-strong': 'line-strong',
      bg: 'ground',
      surface: 'bg',
    };

    for (const [name, token] of Object.entries(light)) {
      expect(colours[name], `wiki light ${name}`).toBe(venizia.light[token]);
    }

    for (const [name, token] of Object.entries(dark)) {
      expect(wikiDark[name], `wiki dark ${name}`).toBe(venizia.dark[token]);
    }

    for (const [name, token] of [
      ['accent', 'accent'],
      ['accent-ink', 'accent-ink'],
      ['accent-text', 'accent-text'],
    ]) {
      expect(accent[name], `product light ${name}`).toBe(venizia.light[token]);
      expect(accentDark[name], `product dark ${name}`).toBe(venizia.dark[token]);
    }
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
