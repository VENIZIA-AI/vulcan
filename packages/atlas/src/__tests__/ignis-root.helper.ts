import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The IGNIS checkout the repo-mode tests read. Atlas moved from IGNIS into VULCAN, so the live tree
 * is no longer this package's grandparent: set `IGNIS_ROOT`, or keep IGNIS as a sibling of VULCAN.
 */
export const IGNIS_ROOT = process.env.IGNIS_ROOT ?? join(__dirname, '../../../../../ignis');

/**
 * A checkout's content - its wiki and knowledge bundle. VULCAN's CI clones no IGNIS (the release ships
 * code only), so the tests that measure atlas against IGNIS's real corpus skip there.
 */
export const IGNIS_IS_PRESENT = existsSync(join(IGNIS_ROOT, '.agents', 'knowledge'));

/**
 * Installed and built: the generators read every package's dist `.d.ts`, and some symbols resolve
 * into IGNIS's node_modules. A bare clone (VULCAN's release CI) has neither, so those tests skip there.
 */
export const IGNIS_IS_BUILT =
  existsSync(join(IGNIS_ROOT, 'node_modules')) &&
  existsSync(join(IGNIS_ROOT, 'packages', 'core-server', 'dist'));

/** The release table is derived from release commits, which a shallow clone does not have. */
export const IGNIS_HAS_HISTORY =
  existsSync(join(IGNIS_ROOT, '.git')) && !existsSync(join(IGNIS_ROOT, '.git', 'shallow'));

/** The last IGNIS commit that still had `path` - the state a parity test against it compares with. */
export const ignisRevisionWithOf = (opts: { path: string }): string | undefined => {
  if (!existsSync(join(IGNIS_ROOT, '.git'))) {
    return undefined;
  }

  const removedIn = spawnSync('git', ['log', '-n1', '--format=%H', '--', opts.path], {
    cwd: IGNIS_ROOT,
    encoding: 'utf8',
  }).stdout.trim();

  return removedIn.length === 0 ? undefined : `${removedIn}~1`;
};

/** `path` as IGNIS had it at `revision`; `undefined` when it did not exist there. */
export const ignisFileAt = (opts: { revision: string; path: string }): string | undefined => {
  const shown = spawnSync('git', ['show', `${opts.revision}:${opts.path}`], {
    cwd: IGNIS_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  return shown.status === 0 ? shown.stdout : undefined;
};

/**
 * A file IGNIS commits, or committed before adopting VULCAN 0.2.0 removed it (its release and symbol
 * tables): read from the working tree when it is there, else from the last commit that still had it.
 * `undefined` when neither has it - the test that needs it skips.
 */
export const ignisCommittedFileOf = (opts: { path: string }): string | undefined => {
  const file = join(IGNIS_ROOT, opts.path);

  if (existsSync(file)) {
    return readFileSync(file, 'utf8');
  }

  const revision = ignisRevisionWithOf(opts);

  return revision === undefined ? undefined : ignisFileAt({ revision, path: opts.path });
};
