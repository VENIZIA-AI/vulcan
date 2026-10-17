import { describe, expect, test } from 'bun:test';
import { VizTheme } from '../../viz/client/theme.ts';

describe('VizTheme.getSectionColor', () => {
  test('uses the comma hsl syntax, the only one Cytoscape accepts (CSS accepts both)', () => {
    expect(VizTheme.getSectionColor({ index: 1, total: 7 })).toMatch(/^hsl\(\d+, 62%, \d+%\)$/);
  });

  test('spreads the sections evenly around the hue wheel', () => {
    expect(VizTheme.getSectionColor({ index: 0, total: 4 })).toStartWith('hsl(0,');
    expect(VizTheme.getSectionColor({ index: 2, total: 4 })).toStartWith('hsl(180,');
  });
});
