import { ExitCodes, VULCAN_VERSION } from '../common/index.ts';

const HELP = `vulcan ${VULCAN_VERSION} - one setup, one workflow for every project

Usage: bun x vulcan <command>

  init [--config ts|mts|mjs|js]   Scaffold the project layer (never overwrites)
  init --preset <name|file:path> --project <name> --app <name> [--backend-dir|--frontend-dir <name>]
       [--shared-dir <name>] [--scope <@scope>]
                                  Create a monorepo with its first app, from a framework preset
                                  (a name missing from the flags is asked in a terminal)
  add --preset <name|file:path> (--app <name> | --lib <name>) [--dir <folder>] [--scope <@scope>]
      [--backend-dir|--frontend-dir <name>] [--api <app> | --no-api]
                                  Add an app or a shared library to the monorepo (a frontend says which
                                  backend to proxy to; --dir is for a library; --scope names the package
                                  @scope/<name>, for an app or a library; a terminal asks for the kind
                                  and every name the flags leave out)
  sync [--agents <list>|list] [--dry-run] [--prune]
                                  Write the adapters of the agents you chose (--agents claude,omp or none,
                                  stored in .agents/vulcan.local.json; --agents list shows the table);
                                  --prune also removes stale hooks and dead skill links
  agents [list|add <ids>|remove <ids>|setup] [--dry-run]
                                  See, add, remove or re-choose the coding agents you use on this machine
  doctor                          Check the project follows VULCAN; exit 1 on any violation
  clean [--tmp|--worktrees|--clones|--cache|--all] [--reports|--prototypes|--profile] [--yes]
                                  List what an agent left under .agents/local/ (a dry run) and, with
                                  --yes, remove it; --tmp is the default, --worktrees takes merged or
                                  gone branches only, --all never touches reports, prototypes or the profile
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
