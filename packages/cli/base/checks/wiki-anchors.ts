/**
 * Gate: every in-page anchor the wiki links to exists in the built site. Needs a build (`make docs`).
 * Run from the repository root, through `make wiki-anchors-check` or directly:
 *   bun node_modules/@venizia/vulcan/base/checks/wiki-anchors.ts
 */
import { runAnchorsCommand } from '../../src/wiki/index.ts';

process.exit(runAnchorsCommand({ args: process.argv.slice(2), root: process.cwd() }));
