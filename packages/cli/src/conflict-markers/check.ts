import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes } from '../common/index.ts';

/** The lines `git merge` writes around a conflict: ours, the base (diff3 style), the divider and theirs. */
const MARKER = /^(?:<{7}|\|{7}|>{7})(?: |\r?$)|^={7}\r?$/;
const SKIP_FLAG = '--skip';
/** Room for the file list of a large repository. */
const LIST_BYTES = 64 * 1024 * 1024;

/** The gate against a merge that was committed unfinished; run by `make conflict-markers-check`. */
export class ConflictMarkers {
  /**
   * Reads every file git tracks under `root` (not links, not binary files, not those under a `--skip` prefix) and writes
   * `file:line: ...` for each conflict marker. Exit 0 for none, 1 for any, 2 for bad arguments or no file list.
   */
  static run(opts: { root: string; args: string[]; write: (text: string) => void }): number {
    const skipped: string[] = [];

    for (let at = 0; at < opts.args.length; at += 2) {
      const prefix = opts.args[at + 1];

      if (opts.args[at] !== SKIP_FLAG || prefix === undefined || prefix === '') {
        opts.write(`conflict-markers: only ${SKIP_FLAG} <path prefix>, as often as needed\n`);

        return ExitCodes.USAGE;
      }

      skipped.push(prefix);
    }

    const listing = spawnSync('git', ['ls-files', '-z'], {
      cwd: opts.root,
      encoding: 'utf8',
      maxBuffer: LIST_BYTES,
    });

    if (listing.status !== 0) {
      opts.write(`conflict-markers: git cannot list the files of ${opts.root}\n`);

      return ExitCodes.USAGE;
    }

    const files = listing.stdout
      .split('\0')
      .filter((file) => file !== '' && !skipped.some((prefix) => file.startsWith(prefix)));
    const found = files.flatMap((file) => ConflictMarkers.markersOf({ root: opts.root, file }));

    for (const line of found) {
      opts.write(`${line}\n`);
    }

    return found.length === 0 ? ExitCodes.OK : ExitCodes.FAILURE;
  }

  private static markersOf(opts: { root: string; file: string }): string[] {
    const path = join(opts.root, opts.file);

    // A file deleted and not yet staged, a link or a submodule has no text of its own here.
    if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) {
      return [];
    }

    const text = readFileSync(path, 'utf8');

    if (text.includes('\0')) {
      return [];
    }

    return text
      .split('\n')
      .flatMap((line, index) =>
        MARKER.test(line)
          ? [`${opts.file}:${index + 1}: git conflict marker \`${line.slice(0, 7)}\``]
          : [],
      );
  }
}
