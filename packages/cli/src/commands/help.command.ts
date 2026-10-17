import { ExitCodes, VULCAN_VERSION } from '../common/index.ts';

const HELP = `vulcan ${VULCAN_VERSION} - one setup, one workflow for every project

Usage: bun x vulcan <command>

  init [--config ts|mts|mjs|js]   Scaffold the project layer (never overwrites)
  sync [--dry-run]                Write the gitignored agent adapters (CLAUDE.md, .claude/)
  doctor                          Check the project follows VULCAN; exit 1 on any violation
  upgrade [<version|tag>]         Bump the pinned @venizia/vulcan, then sync
  x <tool> [args...]              Run a shipped tool at the pinned version: okf, atlas
  help · version
`;

export const runHelpCommand = async (): Promise<number> => {
  process.stdout.write(HELP);

  return ExitCodes.OK;
};

export const runVersionCommand = async (): Promise<number> => {
  process.stdout.write(`${VULCAN_VERSION}\n`);

  return ExitCodes.OK;
};
