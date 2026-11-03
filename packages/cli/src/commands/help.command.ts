import { ExitCodes, VULCAN_VERSION } from '../common/index.ts';

const HELP = `vulcan ${VULCAN_VERSION} - one setup, one workflow for every project

Usage: bun x vulcan <command>

  init                            Scaffold the project layer (never overwrites)
  init --preset <name|file:path> --project <name> --app <name> [--backend-dir|--frontend-dir <path>]
       [--shared-dir <path>] [--scope <@scope>]
                                  Create a monorepo with its first app, from a framework preset
                                  (a name missing from the flags is asked in a terminal)
  add --preset <name|file:path> (--app <name> | --lib <name> | --shared <name>) [--dir <folder>]
      [--scope <@scope>] [--backend-dir|--frontend-dir <path>] [--api <app> | --no-api]
                                  Add an app, a library other apps import (--lib) or a side-neutral package
                                  other apps import (--shared) to the monorepo (a frontend says which
                                  backend to proxy to; --dir is for a library or a shared package;
                                  --scope names the package @scope/<name>; a terminal asks for the kind
                                  and every name the flags leave out)
  preset diff <package> [--preset <name|file:path>] [--api <app> | --no-api] [--full] [--check]
                                  Read-only: set each file the preset makes now (for an app, a library or
                                  a shared package) against the file the package has (same, differs,
                                  missing); --full prints the unified diffs, --check exits 1 when
                                  anything differs or is missing
  sync [--agents <list>|list] [--dry-run]
                                  Write the adapters of the agents you chose (--agents claude,omp or none,
                                  stored in .agents/vulcan.local.json; --agents list shows the table)
  agents [list|add <ids>|remove <ids>|setup] [--dry-run]
                                  See, add, remove or re-choose the coding agents you use on this machine
  doctor                          Check the project follows VULCAN; exit 1 on any violation
  commit-check <message-file> | --range <revs> | --text <message>
                                  Check a commit message against the commit.message checks of the config (an
                                  agent in a trailer or a "generated with" line, the project's subject shape);
                                  sync installs it as the commit-msg hook; exit 1 on a problem, 2 on bad input
  board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
                                  Fold the event log (and GitHub pull requests, checks and reviews when gh
                                  can read them) into flows and write one HTML file, by default
                                  .agents/local/reports/board.html; read-only; exit 2 on bad input
  ci affected --base <ref> [--head <ref>] [--check <check>] [--json | --names] | template <github|gitlab>
                                  List the workspace packages a change touches (changed ones and what
                                  depends on them) with the checks each has; template prints a CI file that
                                  runs exactly those; exit 2 on bad input
  event add --kind <k> --summary <text> [--flow F-n] [--ref <r>] [--status approve|park|reject] | tail [--since <time>] [--json] [--dir <folder>]
                                  Write a line to the agent event log (.agents/local/events/<day>.jsonl) or
                                  read it; with events.log on, sync installs the Claude Code hooks that
                                  write it; exit 2 on bad input
  visualize <spec.json> [--out <name>] | --schema
                                  Make one small static HTML page (a flow, a status, a before and after) from
                                  a JSON spec, in .agents/local/prototypes/; --schema prints the spec's schema
  profile [show|edit|reset [--yes]]
                                  Tell VULCAN how you like to work (reply language, how to address you,
                                  tone, habits) in .agents/local/profile.json; no argument runs the form,
                                  show prints it, reset deletes it
  clean [--tmp|--worktrees|--clones|--cache|--all] [--reports|--prototypes|--events|--release-candidates|--profile] [--yes]
                                  List what an agent left under .agents/local/ (a dry run) and, with
                                  --yes, remove it; --tmp is the default, --worktrees takes merged or
                                  gone branches only, --all never touches reports, prototypes, events, release candidates or the profile
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
