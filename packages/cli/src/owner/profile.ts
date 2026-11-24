import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { ProfileKeys } from '../agents/profile-keys.ts';
import { MACHINE_KEYS } from '../agents/local.ts';
import { RecordValue } from '../common/record.ts';
import { OwnerConstants } from './constants.ts';
import { PROFILE_SCHEMA } from './schema.ts';
import type { TProfile } from './schema.ts';

type TProfileRead = { ok: true; profile: TProfile | undefined } | { ok: false; error: string };

const SYMLINK_ERROR = `${OwnerConstants.PROFILE_FILE} (or .agents/local) is a symlink - it must be a regular file inside the project`;

/** Reads, renders and writes the per-person owner profile file inside `.agents/local`; used by `vulcan profile`, `vulcan project doctor` and the session digest. */
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

  /**
   * The machine's keys of the file as it is now, each one checked on its own against its schema: `kept` holds the valid
   * ones, `dropped` names the keys that are not valid (a write or a reset must not carry a broken key forward).
   */
  static machineKeysOf(opts: { root: string }): {
    kept: Record<string, unknown>;
    dropped: string[];
  } {
    try {
      const file: unknown = JSON.parse(
        readFileSync(join(opts.root, OwnerConstants.PROFILE_FILE), 'utf8'),
      );
      // A profile `sync` has not moved yet has the old keys: they are read at their new paths, so a reset keeps them.
      const current = RecordValue.isRecord(file) ? ProfileKeys.toNew({ value: file }).value : {};
      const found = Object.entries(current).filter(([key]) => Object.hasOwn(MACHINE_KEYS, key));
      const checked = found.map(([key, value]) => ({
        key,
        value,
        isValid:
          Object.entries(MACHINE_KEYS)
            .find(([name]) => name === key)?.[1]
            ?.safeParse(value).success === true,
      }));

      return {
        kept: Object.fromEntries(
          checked.filter((item) => item.isValid).map((item) => [item.key, item.value]),
        ),
        dropped: checked.filter((item) => !item.isValid).map((item) => item.key),
      };
    } catch {
      return { kept: {}, dropped: [] };
    }
  }

  /**
   * The owner's answers removed from the profile: the machine's valid keys stay (a file with none is deleted), and a machine key
   * that is not valid is dropped and named, so a broken `events.dir` cannot keep the form and the reset going in a circle.
   * Never follows a symlink: the caller checks `linkedAt` first.
   */
  static reset(opts: { root: string }): { kept: string[]; dropped: string[]; isDeleted: boolean } {
    const file = join(opts.root, OwnerConstants.PROFILE_FILE);
    const { kept, dropped } = OwnerProfile.machineKeysOf(opts);

    if (Object.keys(kept).length === 0) {
      rmSync(file, { force: true });

      return { kept: [], dropped, isDeleted: true };
    }

    writeFileSync(
      file,
      `${JSON.stringify({ schemaVersion: OwnerConstants.PROFILE_SCHEMA_VERSION, ...kept }, null, 2)}\n`,
      { mode: 0o600 },
    );

    return { kept: Object.keys(kept), dropped, isDeleted: false };
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
    // The form knows the owner's keys only: this machine's keys (`agents`, `board`, `local`, `events`) of the file stay.
    const { kept } = OwnerProfile.machineKeysOf({ root: opts.root });
    const parsed = PROFILE_SCHEMA.safeParse(
      typeof opts.profile === 'object' && opts.profile !== null
        ? { ...kept, ...opts.profile }
        : opts.profile,
    );

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'not a profile' };
    }

    if (!OwnerProfile.profileIsIgnored({ root: opts.root })) {
      return {
        ok: false,
        error: `.gitignore does not list .agents/local/ - run vulcan project sync (or add the line) before saving a personal profile`,
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
