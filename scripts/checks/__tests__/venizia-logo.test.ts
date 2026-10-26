import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENIZIA_LOGO_SVG } from '../../../docs/wiki/site/.vitepress/theme/shared/venizia-logo.ts';

const TOKENS = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'docs/wiki/site/.vitepress/theme/shared/tokens.css'),
  'utf8',
);

// The Venizia logo is a brand asset: its colours are the official ones, whatever surrounds it.
describe('the Venizia wordmark', () => {
  test('is filled by the wordmark token, never by the surrounding text colour', () => {
    expect(VENIZIA_LOGO_SVG).not.toContain('currentColor');
    expect(VENIZIA_LOGO_SVG.match(/class="venizia-wordmark"/g)).toHaveLength(7);
    expect(TOKENS).toContain('.venizia-wordmark {\n  fill: var(--venizia-wordmark);\n}');
  });

  test('is #12141A in light and white in dark, as venizia.ai/assets/logo.svg and logo-white.svg', () => {
    const darkAt = TOKENS.indexOf('\n.dark {');

    expect(darkAt).toBeGreaterThan(0);
    expect(TOKENS.slice(0, darkAt).toLowerCase()).toContain('--venizia-wordmark: #12141a;');
    expect(TOKENS.slice(darkAt).toLowerCase()).toContain('--venizia-wordmark: #ffffff;');
  });

  test('keeps the official overflow so the bottom edge of the letters is not clipped', () => {
    expect(VENIZIA_LOGO_SVG).toContain('overflow="visible"');
  });

  test('keeps the arc in the brand blue #0A6BFF in both themes', () => {
    expect(VENIZIA_LOGO_SVG.match(/fill="#0A6BFF"/g)).toHaveLength(3);
  });
});
