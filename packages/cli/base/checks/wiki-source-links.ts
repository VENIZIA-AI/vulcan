/**
 * Gate: every source path the wiki and the knowledge bundle name is tracked by git. Run from the
 * repository root, through `make wiki-links-check WIKI_REPO=<owner/name>` or directly:
 *   bun node_modules/@venizia/vulcan/base/checks/wiki-source-links.ts --repo <owner/name>
 * The folders it checks come from the `layout` of `.configs/vulcan.config.mts`; with no layout, the default list.
 */
import { ConfigLoader } from '../../src/config/index.ts';
import { runSourceLinksCommand } from '../../src/wiki/index.ts';

const root = process.cwd();
const loaded = await ConfigLoader.load({ root });
const note = ConfigLoader.unreadableNote({ loaded });

if (note !== undefined) {
  console.error(`wiki-source-links: ${note}`);
}

process.exit(
  runSourceLinksCommand({
    args: process.argv.slice(2),
    root,
    layout: loaded.ok ? loaded.config.layout : undefined,
  }),
);
