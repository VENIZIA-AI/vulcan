import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OwnerConstants } from './constants.ts';
import { PROFILE_SCHEMA } from './schema.ts';
import type { TProfile } from './schema.ts';

export type TProfileRead =
  | { ok: true; profile: TProfile | undefined }
  | { ok: false; error: string };

/** The personal profile of the developer at `root`: absent reads as none, a broken file says what is wrong. */
export const readProfile = (opts: { root: string }): TProfileRead => {
  const file = join(opts.root, OwnerConstants.PROFILE_FILE);

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
};

/** Whether the project's `.gitignore` names `.agents/local/`: a personal file must never be committed. */
export const profileIsIgnored = (opts: { root: string }): boolean => {
  const file = join(opts.root, '.gitignore');

  return (
    existsSync(file) &&
    readFileSync(file, 'utf8')
      .split('\n')
      .some((line) => ['.agents/local/', '.agents/local', '/.agents/local/'].includes(line.trim()))
  );
};

/** The profile as the file holds it. */
export const renderProfile = (opts: { profile: TProfile }): string =>
  `${JSON.stringify(opts.profile, null, 2)}\n`;

/**
 * Saves the profile. It refuses while `.gitignore` is missing or does not list `.agents/local/`, so a
 * personal file cannot be written where a commit could pick it up.
 */
export const writeProfile = (opts: {
  root: string;
  profile: unknown;
}): { ok: true } | { ok: false; error: string } => {
  const parsed = PROFILE_SCHEMA.safeParse(opts.profile);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'not a profile' };
  }

  if (!profileIsIgnored({ root: opts.root })) {
    return {
      ok: false,
      error: `.gitignore does not list .agents/local/ - run vulcan sync (or add the line) before saving a personal profile`,
    };
  }

  const file = join(opts.root, OwnerConstants.PROFILE_FILE);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderProfile({ profile: parsed.data }), { mode: 0o600 });

  return { ok: true };
};
