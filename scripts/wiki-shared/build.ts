/**
 * Builds the wiki and checks the build. The check itself is in the shared theme folder
 * (docs/wiki/site/.vitepress/theme/shared/build-check.ts), so IGNIS and ARDOR have the very same file; this is
 * the entry `make docs` runs here.
 *
 *   bun scripts/wiki-shared/build.ts                         build docs/wiki and check it
 *   bun scripts/wiki-shared/build.ts --check [--log <file>]   check the last build (and scan the log of it)
 */
import { resolve } from 'node:path';
import { BuildCheck } from '../../docs/wiki/site/.vitepress/theme/shared/build-check.ts';

if (import.meta.main) {
  const logAt = process.argv.indexOf('--log');

  process.exit(
    BuildCheck.run({
      root: resolve(import.meta.dir, '..', '..'),
      build: !process.argv.includes('--check'),
      logFile: logAt === -1 ? undefined : process.argv[logAt + 1],
    }),
  );
}
