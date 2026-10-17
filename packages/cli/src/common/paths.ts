import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The installed `@venizia/vulcan` directory, in a workspace or a project's node_modules. */
export const PACKAGE_ROOT = resolve(import.meta.dir, '..', '..');

/** The shipped base: rules, slots, skills, settings, hooks, make module, templates. */
export const BASE_DIRECTORY = join(PACKAGE_ROOT, 'base');

export const VULCAN_VERSION: string = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
).version;
