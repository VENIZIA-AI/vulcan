import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { BoardConstants } from './common/index.ts';
import type { IBoardData } from './common/index.ts';

/** The board as one HTML file: the page of `base/templates/board.html` with the data inside it. */
export class BoardPage {
  /**
   * The page with `data` embedded as JSON in a `script` of type `application/json`. `<` and the two line separators
   * are escaped, so no text in the data can close the script or break it. Nothing is fetched when the page opens.
   */
  static render(opts: { data: IBoardData; template?: string }): string {
    const template =
      opts.template ?? readFileSync(join(BASE_DIRECTORY, BoardConstants.TEMPLATE), 'utf8');
    const json = JSON.stringify(opts.data)
      .replaceAll('<', '\\u003c')
      .replaceAll(' ', '\\u2028')
      .replaceAll(' ', '\\u2029');

    return template.replace(
      BoardConstants.DATA_MARKER,
      () => `<script type="application/json" id="board-data">${json}</script>`,
    );
  }
}
