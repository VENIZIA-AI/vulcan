import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { BoardServe } from './common/index.ts';

/**
 * The page `--open` gives the program that opens the browser, so the address with the token is in no argument list. It
 * lives in a folder of its own that only this user can enter: the tmp folder it is made in can be written by others,
 * and a page they put under a name we chose would be run by the browser.
 */
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

  /**
   * Makes a private folder (mode 0700, owned by `uid`, default the process user) in `folder`, which is made when
   * missing, and writes `index.html` in it for its owner only. Throws when the folder made is not private; nothing
   * is left behind then. Mode and owner are not checked where the system has no user id (Windows).
   */
  static write(opts: { folder: string; url: string; uid?: number }): {
    directory: string;
    path: string;
  } {
    const uid = opts.uid ?? process.getuid?.();

    mkdirSync(opts.folder, { recursive: true });
    BoardOpenFile.sweep({ folder: opts.folder, ...(uid === undefined ? {} : { uid }) });

    const directory = mkdtempSync(join(opts.folder, BoardServe.OPEN_DIRECTORY_PREFIX));

    try {
      chmodSync(directory, 0o700);

      const stat = lstatSync(directory);

      if (
        !stat.isDirectory() ||
        (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0))
      ) {
        throw new Error(`${directory} is not a private folder of this user`);
      }

      const path = join(directory, BoardServe.OPEN_FILE_NAME);

      writeFileSync(path, BoardOpenFile.htmlOf({ url: opts.url }), { flag: 'wx', mode: 0o600 });

      return { directory, path };
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });

      throw error;
    }
  }

  /** Removes the folder and the page in it; a folder that is already gone is not an error. */
  static remove(opts: { directory: string }): void {
    rmSync(opts.directory, { recursive: true, force: true });
  }

  /**
   * Removes the folders `write` made in `folder` that belong to `uid` and are older than `OPEN_STALE_MS`, left by a
   * run that was killed. A link is not followed and a folder that cannot be removed is reported, not thrown.
   */
  static sweep(opts: { folder: string; uid?: number }): void {
    if (!existsSync(opts.folder)) {
      return;
    }

    const uid = opts.uid ?? process.getuid?.();

    try {
      for (const entry of readdirSync(opts.folder, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(BoardServe.OPEN_DIRECTORY_PREFIX)) {
          continue;
        }

        const directory = join(opts.folder, entry.name);
        const stat = lstatSync(directory);

        if (
          stat.isDirectory() &&
          (uid === undefined || stat.uid === uid) &&
          Date.now() - stat.mtimeMs > BoardServe.OPEN_STALE_MS
        ) {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (error) {
      process.stderr.write(
        `board: cannot clear old pages in ${opts.folder}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}
