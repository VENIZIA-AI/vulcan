import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VizPalette } from '../../viz/palette.ts';
import { clearProjectConfig, TEST_MANIFEST, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const VIZ = join(import.meta.dir, '../../viz');
const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe('VizPalette.read', () => {
  test('each page variable takes the colour of its token, per mode', () => {
    useProjectConfig({ root: '/project', config: {} });

    const { light, dark } = VizPalette.read();
    const { light: tokens, dark: darkTokens } = TEST_MANIFEST.theme.tokens;

    expect(light).toEqual({
      bg: tokens.ground,
      'bg-soft': tokens.bg,
      'bg-alt': tokens.ground,
      text: tokens.ink,
      'text-2': tokens.muted,
      border: tokens.line,
      brand: tokens['accent-text'],
      'brand-ink': tokens['accent-ink'],
    });
    expect(dark.bg).toBe(darkTokens.ground);
    expect(dark.brand).toBe(darkTokens['accent-text']);
  });

  test('a manifest with no theme tokens, or one token short, is refused and names the token', () => {
    useProjectConfig({ root: '/project', config: {}, manifest: {} });
    expect(() => VizPalette.read()).toThrow("no light theme token 'ground'");

    const { light } = TEST_MANIFEST.theme.tokens;

    useProjectConfig({
      root: '/project',
      config: {},
      manifest: { theme: { tokens: { light, dark: { ...light, ink: 7 } } } },
    });
    expect(() => VizPalette.read()).toThrow("no dark theme token 'ink'");
  });

  test('a run with no manifest at all is refused', () => {
    useProjectConfig({ root: '/project', config: {} });
    delete process.env.VULCAN_MANIFEST;

    expect(() => VizPalette.read()).toThrow('run okf through `vulcan x`');
  });
});

describe('the explorer page holds no colour of its own', () => {
  test('the template and the client source carry no hex colour, so a theme change reaches every part', () => {
    const files = ['template.html', 'client/explorer.ts', 'client/theme.ts', 'client/main.ts'];

    for (const file of files) {
      expect(readFileSync(join(VIZ, file), 'utf8'), file).not.toMatch(HEX);
    }
  });
});
