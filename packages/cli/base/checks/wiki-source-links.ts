/**
 * Gate: every source path the wiki and the knowledge bundle name is tracked by git. Run from the
 * repository root, through `make wiki-links-check WIKI_REPO=<owner/name>` or directly:
 *   bun node_modules/@venizia/vulcan/base/checks/wiki-source-links.ts --repo <owner/name>
 */
import { runSourceLinksCommand } from '../../src/wiki/index.ts';

process.exit(runSourceLinksCommand({ args: process.argv.slice(2), root: process.cwd() }));
