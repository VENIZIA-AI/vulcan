import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { RecordValue } from '../common/record.ts';
import { CiConstants } from './common/index.ts';

/** The files every package depends on: when one changes, all of them are affected. */
export class CiGlobal {
  /** The shipped list (data, `base/ci-global.json`) and the project's own from the manifest. */
  static read(opts: { root: string }): string[] {
    return [...CiGlobal.shipped(), ...CiGlobal.project({ root: opts.root })];
  }

  /** The first file of `files` that matches one of `globs` (root-relative, dotfiles included). */
  static firstHit(opts: { files: string[]; globs: string[] }): string | undefined {
    const matchers = opts.globs.map((glob) => new Bun.Glob(glob));

    return opts.files.find((file) => matchers.some((matcher) => matcher.match(file)));
  }

  private static shipped(): string[] {
    const list: unknown = JSON.parse(
      readFileSync(join(BASE_DIRECTORY, CiConstants.GLOBAL_FILE), 'utf8'),
    );

    return RecordValue.isRecord(list) ? CiGlobal.stringsOf({ value: list.files }) : [];
  }

  private static project(opts: { root: string }): string[] {
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(join(opts.root, CiConstants.MANIFEST_FILE), 'utf8'),
      );
      const ci = RecordValue.isRecord(manifest) ? manifest.ci : undefined;
      const affected = RecordValue.isRecord(ci) ? ci.affected : undefined;

      return RecordValue.isRecord(affected) ? CiGlobal.stringsOf({ value: affected.global }) : [];
    } catch {
      return [];
    }
  }

  private static stringsOf(opts: { value: unknown }): string[] {
    return Array.isArray(opts.value)
      ? opts.value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
      : [];
  }
}
