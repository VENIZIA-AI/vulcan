import { GeneratedBlock } from './generated-block.ts';

const { start: ATLAS_BLOCK_START, end: ATLAS_BLOCK_END } = GeneratedBlock.markersOf({
  name: 'atlas',
  origin: '.configs/vulcan.config.*',
});

export class AtlasBlock {
  /**
   * The guidance every agent that reads AGENTS.md gets, whatever its client drops of the MCP server's
   * own text. Rendered from the config, so it is the same for every developer and safe to commit.
   */
  static render(opts: { project: string; sources: string[] }): string {
    return [
      ATLAS_BLOCK_START,
      '## Atlas',
      '',
      `The \`atlas\` MCP server holds the real code and docs of: ${[`${opts.project} (this repository)`, ...opts.sources].join(', ')}.`,
      'Look facts up there before you answer or write from memory (V-P-07):',
      '`symbol` before you use an export (signature, import path, source line); `search`, then `get`, for how something works or which convention applies; `version` or `changes` for a release or an upgrade.',
      'A new app or package: ask `presets` which preset and which `vulcan add` command, run it, and never hand-write package.json, tsconfig or scripts.',
      'How to build something here (a feature, a controller, a service, a repository): `search` first, then `get`, before you answer; a plan never says "check atlas" for a step you have not done.',
      ATLAS_BLOCK_END,
      '',
    ].join('\n');
  }

  /** Puts the block into AGENTS.md; see `GeneratedBlock.merge`. */
  static merge(opts: { text: string; block: string }): { changed: boolean; text: string } {
    return GeneratedBlock.merge({ ...opts, name: 'atlas' });
  }
}
