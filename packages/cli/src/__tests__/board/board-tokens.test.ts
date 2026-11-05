import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardCommand } from '../../board/command.ts';
import { BoardPage } from '../../board/page.ts';
import { BoardServer } from '../../board/server.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/schema.ts';
import { ThemeTokens } from '../../theme/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { sampleData } from './sample-data.helper.ts';

afterAll(removeProjects);
afterEach(() => BoardServer.stop());

const SHELL = readFileSync(join(import.meta.dir, '../../board/ui/shell.html'), 'utf8');
/** The colours the shell keeps for itself: the line of its own panes and the mascot, not part of the shared tokens. */
const PRIVATE = new Set(['line-2', 'face-ink', 'cheek']);
/** The tokens whose preset values the shell must not hold as literals: the accent and the states. */
const NOT_IN_SHELL = ['accent', 'accent-soft', 'ok', 'wait', 'fail'];
const venizia = ThemeTokens.PRESETS.venizia;
const slate = ThemeTokens.resolve({ theme: { preset: 'slate', radius: '2px' } });
const INJECTION = '4px}</style><script>alert(document.title)</script><style>';

/** A project whose manifest holds the tokens of `theme`, the way `vulcan sync` writes them. */
const projectWith = (opts: { theme: object }): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': JSON.stringify({ theme: opts.theme }),
      '.git/HEAD': 'ref: refs/heads/x\n',
    },
  });

const slateManifestTheme = (): object => {
  if (!slate.ok) {
    throw new Error('slate must resolve');
  }

  const { preset, light, dark, font, mono, radius } = slate.tokens;

  return { preset, tokens: { light, dark }, font, mono, radius };
};

describe('the board takes its colours from the design tokens', () => {
  test('the page carries the tokens of the default preset in every block the shell used to hold', () => {
    const page = BoardPage.render({ data: sampleData() });

    expect(page).toContain('<style id="board-tokens">');
    expect(page).toContain(`:root{--ground:${venizia.light.ground};`);
    expect(page).toContain(`:root[data-board-theme='light']{--ground:${venizia.light.ground};`);
    expect(page).toContain(`:root[data-board-theme='dark']{--ground:${venizia.dark.ground};`);
    expect(page).toContain(`:root[data-theme='dark']{--ground:${venizia.dark.ground};`);
    expect(page).toContain(`--accent:${venizia.dark.accent}`);
    expect(page).toContain(`--stroke-strong:${venizia.light['line-strong']}`);
    expect(page).toContain(`--focus:${venizia.light.accent};--r:${ThemeTokens.RADIUS}}`);
    expect(page.slice(0, page.indexOf('</head>'))).not.toContain('BOARD_TOKENS');
  });

  test('the text colour of the accent and the greys of the panes come with the tokens, in each mode', () => {
    const page = BoardPage.render({ data: sampleData() });
    const darkBlock = /:root\[data-board-theme='dark'\]\{[^}]*\}/.exec(page)?.[0] ?? '';

    expect(page).toContain(`--accent-text:${venizia.light['accent-text']}`);
    expect(darkBlock).toContain(`--accent-text:${venizia.dark['accent-text']}`);
    expect(page).toContain(`--head:${ThemeTokens.SURFACES.light.head}`);
    expect(darkBlock).toContain(`--sunk:${ThemeTokens.SURFACES.dark.sunk}`);
  });

  test('another preset or a project override changes the page', () => {
    const page = BoardPage.render({
      data: sampleData(),
      tokens: slate.ok ? slate.tokens : undefined,
    });

    expect(page).toContain(`--accent:${ThemeTokens.PRESETS.slate.seed.accent}`);
    expect(page).toContain('--r:2px');
    expect(page).not.toContain(`--accent:${venizia.light.accent}`);
  });

  test('the shell holds no colour of the shared tokens: only the private ones, by name', () => {
    const declared = [...SHELL.matchAll(/^\s+--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/gm)].map(
      (m) => m[1],
    );
    const stray = declared.filter((name) => !PRIVATE.has(name));
    const literals = NOT_IN_SHELL.flatMap((name) => [venizia.light[name], venizia.dark[name]]);

    expect(declared.length).toBeGreaterThan(5);
    expect(stray).toEqual([]);

    for (const colour of literals) {
      expect(SHELL.toLowerCase(), colour).not.toContain(colour);
    }
  });

  test('text in the accent is drawn in accent-text, never in accent', () => {
    expect(SHELL).not.toMatch(/^\s+color:\s*var\(--accent\)/m);
  });
});

describe('the tokens come from the manifest of the project', () => {
  test('they are read from it, and the default preset is used when it has none or an unreadable one', () => {
    const withManifest = projectWith({ theme: slateManifestTheme() });
    const short = projectWith({ theme: { tokens: { light: {} } } });
    const empty = createProject({ files: {} });

    expect(ThemeTokens.read({ root: withManifest }).tokens.light.accent).toBe(
      ThemeTokens.PRESETS.slate.seed.accent,
    );
    expect(ThemeTokens.read({ root: empty })).toEqual({ tokens: ThemeTokens.defaults() });
    expect(ThemeTokens.read({ root: short }).tokens).toEqual(ThemeTokens.defaults());
    expect(ThemeTokens.read({ root: short }).warning).toContain('not readable by this version');
  });

  test('a radius that is not a length is refused when the config loads and when the manifest is read', () => {
    const root = projectWith({ theme: { ...slateManifestTheme(), radius: INJECTION } });
    const read = ThemeTokens.read({ root });

    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: { radius: INJECTION } }).success).toBe(false);
    expect(ThemeTokens.resolve({ theme: { radius: INJECTION } }).ok).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: { radius: '0.25rem' } }).success).toBe(true);
    expect(read.tokens.radius).toBe(ThemeTokens.RADIUS);
    expect(read.warning).toBeDefined();
    expect(BoardPage.render({ data: sampleData(), tokens: read.tokens })).not.toContain(
      '<script>alert',
    );
  });

  test('a text colour that passes on the page and fails on a pane of the board is refused, naming the pane', () => {
    // #6f6f6f is 4.61:1 on the ground (#f5f5f5) and 4.49:1 on the soft pane (#f2f2f2).
    const result = ThemeTokens.resolve({ theme: { tokens: { muted: { light: '#6f6f6f' } } } });

    expect(!result.ok && result.problems).toEqual([
      expect.stringMatching(/^light: muted #6f6f6f as text on soft #f2f2f2 is 4\.49:1/),
    ]);
  });

  test('vulcan board writes a page in the colours of the manifest', () => {
    const root = projectWith({ theme: slateManifestTheme() });
    const result = runCli({
      args: ['board', '--no-github', '--since', '2026-11-01'],
      cwd: root,
      env: hermeticEnv(),
    });
    const page = readFileSync(result.stdout.trim(), 'utf8');

    expect(result.code, result.stderr).toBe(0);
    expect(page).toContain(`--accent:${ThemeTokens.PRESETS.slate.seed.accent}`);
    expect(page).toContain('--r:2px');
  });

  test('vulcan board says so on stderr when the manifest theme cannot be read, and uses the default', () => {
    const root = projectWith({ theme: { tokens: { light: {} } } });
    const result = runCli({
      args: ['board', '--no-github', '--since', '2026-11-01'],
      cwd: root,
      env: hermeticEnv(),
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('board: the manifest theme is not readable by this version');
    expect(readFileSync(result.stdout.trim(), 'utf8')).toContain(
      `--accent:${venizia.light.accent}`,
    );
  });

  test('board serve serves the tokens it was started with', async () => {
    const root = projectWith({ theme: slateManifestTheme() });
    const dir = join(root, '.agents/local/events');

    mkdirSync(dir, { recursive: true });

    const server = await BoardServer.start({
      dir,
      collect: () =>
        BoardCommand.collect({
          root,
          dir,
          since: Date.parse('2026-11-01'),
          args: { repos: [], noGithub: true },
        }),
      port: 0,
      tokens: ThemeTokens.read({ root }).tokens,
    });
    const response = await fetch(server.url);
    const html = await response.text();

    expect(html).toContain(`--accent:${ThemeTokens.PRESETS.slate.seed.accent}`);
  });
});
