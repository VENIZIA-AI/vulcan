import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardPage } from '../../board/page.ts';
import { ThemeTokens } from '../../theme/index.ts';
import { createProject } from '../project.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const SHELL = readFileSync(join(import.meta.dir, '../../board/ui/shell.html'), 'utf8');
/** The colours the shell keeps for itself: surfaces of its own panes and the mascot, not part of the shared tokens. */
const PRIVATE = new Set(['head', 'soft', 'sunk', 'line-2', 'face-ink', 'cheek']);
const venizia = ThemeTokens.PRESETS.venizia;

describe('the board takes its colours from the design tokens', () => {
  test('the page carries the tokens of the default preset in every block the shell used to hold', () => {
    const page = BoardPage.render({ data: sampleData() });

    expect(page).toContain('<style id="board-tokens">');
    expect(page).toContain(`:root{--ground:${venizia.light.ground};`);
    expect(page).toContain(`--accent:${venizia.dark.accent}`);
    expect(page).toContain(`:root[data-board-theme='light']{--ground:${venizia.light.ground};`);
    expect(page).toContain(`--stroke-strong:${venizia.light['line-strong']}`);
    expect(page).toContain('--focus:#8a5a20;--r:4px}');
    expect(page.slice(0, page.indexOf('</head>'))).not.toContain('BOARD_TOKENS');
  });

  test('another preset or a project override changes the page', () => {
    const slate = ThemeTokens.resolve({ theme: { preset: 'slate', radius: '2px' } });
    const page = BoardPage.render({
      data: sampleData(),
      tokens: slate.ok ? slate.tokens : undefined,
    });

    expect(page).toContain('--accent:#3f5266');
    expect(page).toContain('--r:2px');
    expect(page).not.toContain('--accent:#8a5a20');
  });

  test('the shell holds no colour of the shared tokens: only the private ones, by name', () => {
    const declared = [...SHELL.matchAll(/^\s+--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/gm)].map(
      (m) => m[1],
    );
    const stray = declared.filter((name) => !PRIVATE.has(name));

    expect(declared.length).toBeGreaterThan(10);
    expect(stray).toEqual([]);
    expect(SHELL).not.toMatch(/#8a5a20|#dead6a|#067647|#b42318/i);
  });

  test('the tokens come from the manifest of the project, and fall back to the default preset', () => {
    const slate = ThemeTokens.resolve({ theme: { preset: 'slate' } });
    const { light, dark, font, mono, radius, preset } = slate.ok
      ? slate.tokens
      : ThemeTokens.defaults();
    const withManifest = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({
          theme: { preset, tokens: { light, dark }, font, mono, radius },
        }),
      },
    });
    const without = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ theme: { tokens: { light: {} } } }),
      },
    });
    const empty = createProject({ files: {} });

    expect(ThemeTokens.read({ root: withManifest }).light.accent).toBe('#3f5266');
    expect(ThemeTokens.read({ root: without })).toEqual(ThemeTokens.defaults());
    expect(ThemeTokens.read({ root: empty })).toEqual(ThemeTokens.defaults());
  });
});
