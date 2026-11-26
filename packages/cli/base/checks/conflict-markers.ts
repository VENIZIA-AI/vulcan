/**
 * Gate: no file git tracks holds a git conflict marker. Run from the repository root, through
 * `make conflict-markers-check` or directly:
 *   bun node_modules/@venizia/vulcan/base/checks/conflict-markers.ts [--skip <path prefix>]...
 */
import { ConflictMarkers } from '../../src/conflict-markers/index.ts';

process.exit(
  ConflictMarkers.run({
    root: process.cwd(),
    args: process.argv.slice(2),
    write: (text) => process.stderr.write(text),
  }),
);
