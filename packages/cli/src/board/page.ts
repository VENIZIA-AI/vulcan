import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { BoardConstants } from './common/index.ts';
import { ThemeTokens } from '../theme/index.ts';
import type { IThemeTokens } from '../theme/index.ts';
import type { IBoardData } from './common/index.ts';

/** The token the board calls by another name: the custom properties of its shell. `--focus` and `--r` follow below. */
const TOKEN_PROPERTIES: Record<string, string> = {
  ground: 'ground',
  bg: 'bg',
  line: 'line',
  'line-strong': 'stroke-strong',
  ink: 'ink',
  body: 'body',
  muted: 'muted',
  accent: 'accent',
  'accent-ink': 'accent-ink',
  'accent-soft': 'accent-soft',
  'accent-text': 'accent-text',
  ok: 'ok',
  'ok-soft': 'ok-soft',
  wait: 'wait',
  'wait-soft': 'wait-soft',
  fail: 'fail',
  'fail-soft': 'fail-soft',
  // The greys of the board's panes (ThemeTokens.SURFACES), written beside the tokens.
  head: 'head',
  soft: 'soft',
  sunk: 'sunk',
};

/** The board as one HTML file: the page of `base/templates/board.html` with the data inside it. */
export class BoardPage {
  /**
   * The page with `data` embedded as JSON in a `script` of type `application/json`. `<` and the two line separators
   * are escaped, so no text in the data can close the script or break it. Nothing is fetched when the page opens.
   */
  static render(opts: { data: IBoardData; template?: string; tokens?: IThemeTokens }): string {
    const template =
      opts.template ?? readFileSync(join(BASE_DIRECTORY, BoardConstants.TEMPLATE), 'utf8');
    const json = JSON.stringify(opts.data)
      .replaceAll('<', '\\u003c')
      .replaceAll(' ', '\\u2028')
      .replaceAll(' ', '\\u2029');

    return template
      .replace(BoardConstants.TOKENS_MARKER, () => BoardPage.tokensStyle({ tokens: opts.tokens }))
      .replace(
        BoardConstants.DATA_MARKER,
        () => `<script type="application/json" id="board-data">${json}</script>`,
      );
  }

  /**
   * The `style` with the tokens as the shell names them: light on `:root`, the system dark setting unless the page
   * was set to light, then each explicit setting (the embedding wiki's `data-theme` and the board's own). The default
   * preset when no tokens are given.
   */
  static tokensStyle(opts: { tokens?: IThemeTokens }): string {
    const tokens = opts.tokens ?? ThemeTokens.defaults();
    const declare = (mode: 'light' | 'dark'): string =>
      `${ThemeTokens.declarations({ mode: { ...tokens[mode], ...ThemeTokens.SURFACES[mode] }, names: TOKEN_PROPERTIES })};--focus:${tokens[mode].accent}`;
    const light = `${declare('light')};--r:${tokens.radius}`;
    const dark = declare('dark');

    return [
      '<style id="board-tokens">',
      `:root{${light}}`,
      `@media (prefers-color-scheme: dark){:root:not([data-theme='light']):not([data-board-theme='light']){${dark}}}`,
      `:root[data-theme='dark']{${dark}}`,
      `:root[data-board-theme='dark']{${dark}}`,
      `:root[data-board-theme='light']{${light}}`,
      '</style>',
    ].join('\n');
  }
}
