import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardServe } from './common/index.ts';

/** The page `--open` gives the program that opens the browser, so the address with the token is in no argument list. */
export class BoardOpenFile {
  /** A page that sends the browser to `url`, with a link for one that does not follow it. */
  static htmlOf(opts: { url: string }): string {
    const url = opts.url
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

    return `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0;url=${url}">\n<title>Board</title>\n<a href="${url}">Open the board</a>\n`;
  }

  /** Writes the page into `folder` (made when missing) for its owner only, under a random name, and returns its path. */
  static write(opts: { folder: string; url: string }): string {
    mkdirSync(opts.folder, { recursive: true });

    const path = join(
      opts.folder,
      `${BoardServe.OPEN_FILE_PREFIX}${randomBytes(BoardServe.OPEN_FILE_BYTES).toString('hex')}.html`,
    );

    writeFileSync(path, BoardOpenFile.htmlOf({ url: opts.url }), { flag: 'wx', mode: 0o600 });

    return path;
  }

  /** Removes the page; a page that is already gone, or cannot be removed, is not an error. */
  static remove(opts: { path: string }): void {
    rmSync(opts.path, { force: true });
  }
}
