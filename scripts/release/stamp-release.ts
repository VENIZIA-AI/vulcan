/**
 * The stable step of a release writes the date into the version folder it releases: `released: YYYY-MM-DD` in the
 * frontmatter of `changelogs/<version>/log.md`, in the promotion commit. A folder with that line is frozen.
 *
 *   bun scripts/release/stamp-release.ts --version <X.Y.Z> --date <YYYY-MM-DD>
 *
 * It prints the path it wrote, so the workflow can `git add` it, and nothing when the project keeps no folder for
 * that version (a project of dated entries). A folder that already carries another date is refused.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GithubRelease } from './github-release.ts';
import { MergeBackConstants, ReleaseMergeBack } from './merge-back.ts';

export class ReleaseStampConstants {
  static readonly VERSION = /^\d+\.\d+\.\d+$/;
  static readonly DATE = /^\d{4}-\d{2}-\d{2}$/;
  static readonly FRONT_MATTER = MergeBackConstants.FRONT_MATTER;
  static readonly RELEASED = MergeBackConstants.RELEASED_LINE;
  static readonly USAGE = 'stamp-release: --version <X.Y.Z> --date <YYYY-MM-DD>';
}

export class ReleaseStamp {
  /**
   * `text` with `released: <date>` as the last line of its frontmatter. `undefined` when it already says that date
   * (nothing to write); an error when it says another, or has no frontmatter to put the line in.
   */
  static stamped(opts: { text: string; date: string }): string | undefined {
    const matched = ReleaseStampConstants.FRONT_MATTER.exec(opts.text);

    if (matched === null) {
      throw new Error('log.md has no frontmatter to write released: into');
    }

    const existing = ReleaseStampConstants.RELEASED.exec(matched[2])?.[1];

    if (existing !== undefined) {
      if (existing === opts.date) {
        return undefined;
      }

      throw new Error(`log.md already says released: ${existing}; a released folder is frozen`);
    }

    return ReleaseMergeBack.withReleased({ text: opts.text, date: opts.date });
  }

  /**
   * Writes the stamp into the version folder of `version` under `cwd` and returns the file it wrote, or `undefined`
   * when the project keeps no folder for that version. The merge-back trial calls it on its copy of main.
   */
  static stampFolder(opts: { cwd: string; version: string; date: string }): string | undefined {
    const file = ReleaseStamp.logOf({ cwd: opts.cwd, version: opts.version });

    if (file === undefined) {
      return undefined;
    }

    const next = ReleaseStamp.stamped({ text: readFileSync(file, 'utf8'), date: opts.date });

    if (next !== undefined) {
      writeFileSync(file, next);
    }

    return file;
  }

  /** The log.md of the version's folder, from the manifest's changelog folder; `undefined` when the project has none. */
  static logOf(opts: { cwd: string; version: string }): string | undefined {
    const { changelogs } = GithubRelease.manifestOf({ cwd: opts.cwd });
    const file = join(opts.cwd, changelogs, opts.version, 'log.md');

    return existsSync(file) ? file : undefined;
  }

  static main(opts: { args: string[]; cwd?: string }): number {
    const version = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--version' });
    const date = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--date' });
    const cwd = opts.cwd ?? process.cwd();

    if (
      version === undefined ||
      date === undefined ||
      !ReleaseStampConstants.VERSION.test(version) ||
      !ReleaseStampConstants.DATE.test(date)
    ) {
      console.error(ReleaseStampConstants.USAGE);

      return 2;
    }

    try {
      const file = ReleaseStamp.stampFolder({ cwd, version, date });

      if (file !== undefined) {
        console.log(file);
      }

      return 0;
    } catch (error) {
      console.error(
        `ERROR | stamp-release: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 1;
    }
  }
}

if (import.meta.main) {
  process.exit(ReleaseStamp.main({ args: process.argv.slice(2) }));
}
