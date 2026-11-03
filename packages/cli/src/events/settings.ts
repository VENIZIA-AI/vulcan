import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventConstants } from './common/index.ts';
import type { IEventSettings } from './common/index.ts';
import { EventRetention } from './retention.ts';

/** Where the log is and whether the Claude Code hooks write it: the `events` block of the manifest `vulcan sync` wrote. */
export class EventSettings {
  /** Why `dir` cannot be the shared folder, or `undefined` when it can. */
  static dirError(opts: { dir: string }): string | undefined {
    if (opts.dir.includes('\0')) {
      return 'a folder path cannot contain a NUL character';
    }

    return isAbsolute(opts.dir)
      ? undefined
      : 'an absolute path, such as /home/me/work/.agents/local/events (~ and relative paths are not expanded)';
  }

  /**
   * What the manifest says; the log is off, in the project's own folder, when the file, the block or a
   * value is missing or is not what sync writes. It never throws: a hook reads it on every event.
   */
  static read(opts: { root: string }): IEventSettings {
    const file = join(opts.root, EventConstants.MANIFEST_FILE);

    if (!existsSync(file)) {
      return { log: false };
    }

    try {
      const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const block = RecordValue.isRecord(manifest) ? manifest.events : undefined;

      if (!RecordValue.isRecord(block)) {
        return { log: false };
      }

      const { dir } = block;

      const { maxSize, maxFiles, maxAgeDays } = block;

      return {
        log: block.log === true,
        ...(typeof dir === 'string' && EventSettings.dirError({ dir }) === undefined
          ? { dir }
          : {}),
        ...(typeof maxSize === 'string' && EventRetention.parseSize({ text: maxSize }) !== undefined
          ? { maxSize }
          : {}),
        ...(typeof maxFiles === 'number' && Number.isInteger(maxFiles) && maxFiles >= 1
          ? { maxFiles }
          : {}),
        ...(typeof maxAgeDays === 'number' && Number.isInteger(maxAgeDays) && maxAgeDays >= 1
          ? { maxAgeDays }
          : {}),
      };
    } catch {
      return { log: false };
    }
  }

  /**
   * The project folder a command run in `cwd` belongs to: the nearest folder above it (itself included) that
   * holds the manifest or `.git`, else `cwd`. A command run in a subfolder then reads the same `events` block
   * as one run at the top; a repository inside a project is a project of its own.
   */
  static rootOf(opts: { cwd: string }): string {
    const start = resolve(opts.cwd);

    for (let directory = start; ; directory = dirname(directory)) {
      if (
        existsSync(join(directory, EventConstants.MANIFEST_FILE)) ||
        existsSync(join(directory, '.git'))
      ) {
        return directory;
      }

      if (dirname(directory) === directory) {
        return start;
      }
    }
  }

  /** The folder the log lives in: the one asked for, else the manifest's `dir`, else the project's own. */
  static dirOf(opts: { root: string; dir?: string; settings?: IEventSettings }): string {
    const settings = opts.settings ?? EventSettings.read({ root: opts.root });

    return resolve(opts.root, opts.dir ?? settings.dir ?? EventConstants.DEFAULT_DIRECTORY);
  }
}
