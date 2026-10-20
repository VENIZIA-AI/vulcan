import { ExitCodes, VULCAN_VERSION } from '../common/index.ts';

const HELP = `vulcan ${VULCAN_VERSION} - one setup, one workflow for every project

Usage: bun x vulcan <command>

  init [--config ts|mts|mjs|js]   Scaffold the project layer (never overwrites)
  init --preset <name|file:path> --project <name> --app <name> [--backend-dir|--frontend-dir <name>]
       [--shared-dir <name>]      Create a monorepo with its first app, from a framework preset
                                  (a name missing from the flags is asked in a terminal)
  add --preset <name|file:path> --app <name> [--backend-dir|--frontend-dir <name>]
      [--api <app> | --no-api]    Add an app to the monorepo (a frontend says which backend to proxy to)
  sync [--dry-run] [--prune]      Write the gitignored agent adapters (CLAUDE.md, .claude/);
                                  --prune also removes stale hooks and dead skill links
  doctor                          Check the project follows VULCAN; exit 1 on any violation
  upgrade [--stable | --nightly] [<version|tag>]
                                  Bump the pinned @venizia/vulcan, then sync; --stable (default)
                                  takes the latest tag, --nightly the newest of latest and next
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
