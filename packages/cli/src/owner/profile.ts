import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OwnerConstants } from './constants.ts';
import { PROFILE_SCHEMA } from './schema.ts';
import type { TProfile } from './schema.ts';

type TProfileRead = { ok: true; profile: TProfile | undefined } | { ok: false; error: string };

const SYMLINK_ERROR = `${OwnerConstants.PROFILE_FILE} (or .agents/local) is a symlink - it must be a regular file inside the project`;

/** Reads, renders and writes the per-person owner profile file inside `.agents/local`; used by `vulcan profile`, `vulcan doctor` and the session digest. */
export class OwnerProfile {
  /** A symlink at the profile's place, or at `.agents/local`, would read or write a file outside the project. */
  static linkedAt(opts: { root: string }): string | undefined {
    return [join(opts.root, OwnerConstants.PROFILE_FILE), join(opts.root, '.agents', 'local')].find(
      (path) => {
        try {
          return lstatSync(path).isSymbolicLink();
        } catch {
          return false;
        }
      },
    );
  }

  /** The personal profile of the developer at `root`: absent reads as none, a broken file says what is wrong. */
  static read(opts: { root: string }): TProfileRead {
    const file = join(opts.root, OwnerConstants.PROFILE_FILE);

    if (OwnerProfile.linkedAt({ root: opts.root }) !== undefined) {
      return { ok: false, error: SYMLINK_ERROR };
    }

    if (!existsSync(file)) {
      return { ok: true, profile: undefined };
    }

    let payload: unknown;

    try {
      payload = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { ok: false, error: `${OwnerConstants.PROFILE_FILE} is not valid JSON` };
    }

    const parsed = PROFILE_SCHEMA.safeParse(payload);

    if (parsed.success) {
      return { ok: true, profile: parsed.data };
    }

    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? '';

    return {
      ok: false,
      error: `${OwnerConstants.PROFILE_FILE}: ${where === '' ? '' : `${where}: `}${issue?.message ?? 'not a profile'}`,
    };
  }

  /**
   * Whether git ignores the profile's place: `git check-ignore` decides when the project is a git repository
   * (so a later `!` line or a nested ignore file counts); otherwise the `.gitignore` is read for the line.
   */
  static profileIsIgnored(opts: { root: string }): boolean {
    const checked = spawnSync(
      'git',
      ['check-ignore', '-q', '--no-index', OwnerConstants.PROFILE_FILE],
      { cwd: opts.root, timeout: 5000 },
    );

    if (checked.status === 0 || checked.status === 1) {
      return checked.status === 0;
    }

    const file = join(opts.root, '.gitignore');

    return (
      existsSync(file) &&
      readFileSync(file, 'utf8')
        .split('\n')
        .some((line) =>
          ['.agents/local/', '.agents/local', '/.agents/local/'].includes(line.trim()),
        )
    );
  }

  /** The profile as the file holds it. */
  static render(opts: { profile: TProfile }): string {
    return `${JSON.stringify(opts.profile, null, 2)}\n`;
  }

  /**
   * Saves the profile. It refuses while `.gitignore` is missing or does not list `.agents/local/`, so a
   * personal file cannot be written where a commit could pick it up.
   */
  static write(opts: {
    root: string;
    profile: unknown;
  }): { ok: true } | { ok: false; error: string } {
    const parsed = PROFILE_SCHEMA.safeParse(opts.profile);

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'not a profile' };
    }

    if (!OwnerProfile.profileIsIgnored({ root: opts.root })) {
      return {
        ok: false,
        error: `.gitignore does not list .agents/local/ - run vulcan sync (or add the line) before saving a personal profile`,
      };
    }

    if (OwnerProfile.linkedAt({ root: opts.root }) !== undefined) {
      return { ok: false, error: SYMLINK_ERROR };
    }

    const file = join(opts.root, OwnerConstants.PROFILE_FILE);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, OwnerProfile.render({ profile: parsed.data }), { mode: 0o600 });
    // `mode` applies to a new file only; an existing one keeps its old mode until this.
    chmodSync(file, 0o600);

    return { ok: true };
  }
}
