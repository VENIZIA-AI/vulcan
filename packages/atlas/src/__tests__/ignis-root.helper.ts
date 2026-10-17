import { existsSync } from 'node:fs';
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
