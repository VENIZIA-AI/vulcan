import { AgentConstants } from '../agents/index.ts';
import { BoardFlags } from '../board/common/index.ts';
import { CommitCheckFlags } from '../commit/common/index.ts';
import { ExitCodes, UpgradeFlags, VULCAN_VERSION, VulcanCommands } from '../common/index.ts';
import { CreateFlags } from '../create/common/index.ts';
import { EventFlags } from '../events/common/index.ts';

/** What the router lets through for a command: the flags that stand alone, the flags that take the next argument, and how many plain arguments. */
export interface IAcceptedArgs {
  flags: string[];
  /** The exit code for an argument the command does not take; `1` when absent. */
  unknownExit?: number;
  values: string[];
  positionals: number;
}

/** One command: what `vulcan help` prints for it, what its flags do, and what its exit codes mean. */
export interface ICommandSpec {
  /** The block `vulcan help` prints for the command: its usage lines, then what it does. */
  help: string;
  /** Flags that stand alone, each with what it does. */
  flags?: Record<string, string>;
  /** Flags that take the next argument, each with what it does. */
  values?: Record<string, string>;
  /** Flags the router lets through and the command does not read. */
  ignored?: { flags: string[]; values: string[] };
  /** How many arguments without a flag the command takes. */
  positionals?: number;
  /** The exit code for an argument the command does not take; `1` when absent. */
  unknownExit?: number;
  /** What the exit codes mean. */
  exits: string;
  /** The arguments are not checked by the router: `x` hands them to its tool, `help` and `version` take none. */
  passthrough?: true;
}

/** Every command in one table: `vulcan help` prints its blocks and the router takes its accepted arguments from it; the generated command reference is to read the flag descriptions and exit codes. */
export class CommandTable {
  static readonly COMMANDS: Record<string, ICommandSpec> = {
    [VulcanCommands.INIT]: {
      help: `  init [--key <KEY>]              Scaffold the project layer (never overwrites); --key is the project's flow key
                                  (2 to 8 uppercase letters or digits; a terminal asks, else it is made from the name)
  init --preset <name|file:path> --project <name> --app <name> [--backend-dir|--frontend-dir <path>]
       [--shared-dir <path>] [--scope <@scope>] [--key <KEY>]
                                  Create a monorepo with its first app, from a framework preset
                                  (a name missing from the flags is asked in a terminal)`,
      values: {
        [CreateFlags.PRESET]: 'The preset package; its presence selects the monorepo mode',
        [CreateFlags.PROJECT]: 'The project name and the folder to create',
        [CreateFlags.BACKEND_DIR]: 'The folder that holds backend apps, 1 to 4 segments',
        [CreateFlags.FRONTEND_DIR]: 'The folder that holds frontend apps, 1 to 4 segments',
        [CreateFlags.SHARED_DIR]: 'A folder for code shared between apps; optional',
        [CreateFlags.APP]: 'The name of the first app',
        [CreateFlags.SCOPE]: "The npm scope of the first app's package, such as @acme",
        [CreateFlags.KEY]: "The project's flow key, 2 to 8 uppercase letters or digits",
      },
      ignored: { flags: [CreateFlags.NO_API], values: [CreateFlags.API] },
      exits:
        '0 on success; 1 when it refuses before writing (not a project, bad or missing name, folder not empty) or bun add fails.',
    },
    [VulcanCommands.ADD]: {
      help: `  add --preset <name|file:path> (--app <name> | --lib <name> | --shared <name>) [--dir <folder>]
      [--scope <@scope>] [--backend-dir|--frontend-dir <path>] [--api <app> | --no-api]
                                  Add an app, a library other apps import (--lib) or a side-neutral package
                                  other apps import (--shared) to the monorepo (a frontend says which
                                  backend to proxy to; --dir is for a library or a shared package;
                                  --scope names the package @scope/<name>; a terminal asks for the kind
                                  and every name the flags leave out)`,
      flags: {
        [CreateFlags.NO_API]: 'A frontend only: proxy to nothing',
      },
      values: {
        [CreateFlags.PRESET]: 'The preset package; a bare name means @venizia/<name>',
        [CreateFlags.BACKEND_DIR]: 'The folder for backend apps, used when the preset is a backend',
        [CreateFlags.FRONTEND_DIR]:
          'The folder for frontend apps, used when the preset is a frontend',
        [CreateFlags.APP]: 'The name of the new app',
        [CreateFlags.API]: 'A frontend only: the backend app to proxy /api to',
        [CreateFlags.LIB]: 'Create a library other apps import, instead of an app',
        [CreateFlags.SHARED]: 'Create a side-neutral package that apps of either side import',
        [CreateFlags.DIR]: 'A library or shared package only: the folder it goes in',
        [CreateFlags.SCOPE]: 'The npm scope of the package name, such as @acme',
      },
      exits: '0 on success; 1 on any refusal, which happens before the first write.',
    },
    [VulcanCommands.PRESET]: {
      help: `  preset diff <package> [--preset <name|file:path>] [--api <app> | --no-api] [--full] [--check]
                                  Read-only: set each file the preset makes now (for an app, a library or
                                  a shared package) against the file the package has (same, differs,
                                  missing); --full prints the unified diffs, --check exits 1 when
                                  anything differs or is missing`,
      flags: {
        [CreateFlags.NO_API]: 'A frontend app only: proxy to nothing',
        [CreateFlags.FULL]: 'Print the unified diff under each file that differs',
        [CreateFlags.CHECK]: 'Exit 1 when a file differs or is missing, for CI',
      },
      values: {
        [CreateFlags.PRESET]: 'The preset to render, when it cannot be found from the package',
        [CreateFlags.API]: 'A frontend app only: the backend app to proxy /api to',
      },
      positionals: 2,
      exits:
        '0 when a report is printed (with --check, and nothing differs); 1 on --check with a difference or missing file, or any refusal.',
    },
    [VulcanCommands.SYNC]: {
      help: `  sync [--agents <list>|list] [--dry-run]
                                  Write the adapters of the agents you chose (--agents claude,omp or none,
                                  stored in .agents/vulcan.local.json; --agents list shows the table)`,
      flags: {
        '--dry-run': 'Print planned changes without writing to disk',
      },
      values: {
        [AgentConstants.FLAG]: 'The agents to write adapters for, comma-separated, none, or list',
      },
      exits:
        '0 on success; 1 when .claude/settings.json cannot be written, or the configuration fails to load.',
    },
    [VulcanCommands.AGENTS]: {
      help: `  agents [list|add <ids>|remove <ids>|setup] [--dry-run]
                                  See, add, remove or re-choose the coding agents you use on this machine`,
      flags: {
        '--dry-run': 'Print what would change and write nothing',
      },
      positionals: 2,
      exits:
        '0 on success, including an agent already chosen or not chosen; 1 on an unknown id, a bad argument or a failed write.',
    },
    [VulcanCommands.DOCTOR]: {
      help: `  doctor                          Check the project follows VULCAN; exit 1 on any violation`,
      exits: '0 for a conformant project; 1 on one or more contract violations.',
    },
    [VulcanCommands.COMMIT_CHECK]: {
      help: `  commit-check <message-file> | --range <revs> | --text <message>
                                  Check a commit message against the commit.message checks of the config (an
                                  agent in a trailer or a "generated with" line, the project's subject shape);
                                  sync installs it as the commit-msg hook; exit 1 on a problem, 2 on bad input`,
      values: {
        [CommitCheckFlags.RANGE]: 'Check every commit of a git range, such as origin/develop..HEAD',
        [CommitCheckFlags.TEXT]: 'Check the message text you give',
      },
      positionals: 2,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 when nothing is wrong or no check is configured; 1 when a message has a problem; 2 on bad input.',
    },
    [VulcanCommands.BOARD]: {
      help: `  board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
                                  Fold the event log (and GitHub or GitLab pull requests, checks and reviews
                                  when gh or glab can read them) into flows and write one HTML file, by default
                                  .agents/local/reports/board.html; read-only; exit 2 on bad input
  board serve [--port <n>] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
                                  Serve the same page on 127.0.0.1 (default port 4317) and push the new events to the open page, with no reload`,
      flags: {
        [BoardFlags.OPEN]: 'Open the file in your browser when it is written',
        [BoardFlags.NO_GITHUB]: 'Do not read GitHub',
      },
      values: {
        [BoardFlags.OUT]: 'The file to write; default .agents/local/reports/board.html',
        [BoardFlags.PORT]: 'serve only: the port to listen on; default 4317',
        [BoardFlags.SINCE]: 'Read events and pull requests changed at or after this date',
        [BoardFlags.DIR]: 'The events folder; default events.dir, else .agents/local/events',
        [BoardFlags.REPO]: 'A GitHub repository, owner/name; repeat it to read several',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 on written or serve stopped; 1 when the file cannot be written or serve cannot start; 2 on bad input.',
    },
    [VulcanCommands.EVENT]: {
      help: `  event add --kind <k> --summary <text> [--flow <flow id>] [--ref <r>] [--status approve|park|reject] [--actor <name>] | add --kind flow [--flow <flow id>] --title <text> [--why <text>] [--context <text>] [--next <text>] [--step|--step-done <text>]... [--check|--check-done <text>]... [--app <name>]... [--due YYYY-MM-DD] | tail [--since <time>] [--json] [--dir <folder>]
                                  Write a line to the agent event log (.agents/local/events/<day>.jsonl) or
                                  read it; with events.log on, sync installs the Claude Code hooks that
                                  write it; exit 2 on bad input`,
      flags: {
        [EventFlags.JSON]: 'Print each line as written (tail)',
      },
      values: {
        [EventFlags.KIND]: 'One of the twelve event kinds',
        [EventFlags.SUMMARY]: 'A short label, cut to one line of 200 characters',
        [EventFlags.FLOW]: 'The id of a flow the log already has',
        [EventFlags.STEP]: 'Flow only, repeatable: a step still to do',
        [EventFlags.STEP_DONE]: 'Flow only, repeatable: a step done',
        [EventFlags.CHECK]: 'Flow only, repeatable: an acceptance check still open',
        [EventFlags.CHECK_DONE]: 'Flow only, repeatable: an acceptance check done',
        [EventFlags.APP]: 'Flow only, repeatable: an app or module the flow touches',
        [EventFlags.DUE]: 'Flow only: the day it is due, YYYY-MM-DD',
        [EventFlags.REF]: 'A commit, a PR number, a recipient, or a tracker id',
        [EventFlags.STATUS]: 'approve, park or reject; required on a decision',
        [EventFlags.TITLE]: 'Flow only, required: the title of the flow',
        [EventFlags.WHY]: 'Flow only: one line on why the flow exists',
        [EventFlags.CONTEXT]: 'Flow only: two to four sentences on what the flow is',
        [EventFlags.NEXT]: 'Flow only: the next step and who does it',
        [EventFlags.ACTOR]: 'Who wrote the event; else VULCAN_ACTOR or the session name',
        [EventFlags.DIR]: 'The events folder for this call, over events.dir',
        [EventFlags.SINCE]: 'tail only: print events at or after this time; default 24 hours',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits: '0 written; 1 when the folder cannot be written; 2 on bad input.',
    },
    [VulcanCommands.VISUALIZE]: {
      help: `  visualize <spec.json> [--out <name>] | --schema
                                  Make one small static HTML page (a flow, a status, a before and after) from
                                  a JSON spec, in .agents/local/prototypes/; --schema prints the spec's schema`,
      flags: {
        '--schema': 'Print the schema of the spec',
      },
      values: {
        [BoardFlags.OUT]: 'The name of the page written in .agents/local/prototypes/',
      },
      positionals: 1,
      exits:
        '0 on success; 1 when the spec is missing or not renderable, or .agents/local/ is missing or outside the project.',
    },
    [VulcanCommands.PROFILE]: {
      help: `  profile [show|edit|reset [--yes]]
                                  Tell VULCAN how you like to work (reply language, how to address you,
                                  tone, habits) in .agents/local/profile.json; no argument runs the form,
                                  show prints it, reset deletes it`,
      flags: {
        '--yes': 'With reset: delete .agents/local/profile.json',
      },
      positionals: 1,
      exits:
        '0 on saved, shown, reset or nothing to reset; 1 on cancelled, unreadable profile, .agents/local/ not gitignored, or unknown argument.',
    },
    [VulcanCommands.CLEAN]: {
      help: `  clean [--tmp|--worktrees|--clones|--cache|--all] [--reports|--prototypes|--events|--release-candidates|--profile] [--include-fresh] [--yes]
                                  List what an agent left under .agents/local/ (a dry run) and, with
                                  --yes, remove it; --tmp is the default and takes stale items only (--include-fresh
                                  adds the rest), --worktrees takes merged or gone branches only, --all never touches reports, prototypes, events, release candidates or the profile`,
      flags: {
        '--tmp': 'Remove the stale items of tmp/ (older than a day); the default',
        '--include-fresh':
          'Also remove items of tmp/ and clones/ that are not stale yet; a live session may be using them',
        '--worktrees': 'Remove worktrees whose branch is merged or gone and that are clean',
        '--clones': 'Remove stale clones of other repositories (older than two weeks)',
        '--cache': 'Remove what atlas fetched; it rebuilds',
        '--reports': 'Remove reports/; kept unless named',
        '--prototypes': 'Remove prototypes/; kept unless named',
        '--profile': 'Remove profile.json; kept unless named',
        '--events': 'Remove event day files past the events limits; only when named',
        '--release-candidates':
          'Remove release-candidate folders whose version tag exists; only when named',
        '--all':
          'Select tmp, worktrees, clones and cache; never reports, prototypes, events, candidates or profile',
        '--yes': 'Remove what the dry run listed',
      },
      exits:
        '0 on a dry run, a removal or nothing to remove; 1 when an item cannot be removed, or on an unknown flag.',
    },
    [VulcanCommands.UPGRADE]: {
      help: `  upgrade [--stable | --nightly] [<version|tag>]
                                  Bump the pinned @venizia/vulcan, then sync; --stable (default)
                                  takes the latest tag, --nightly the newest of latest and next`,
      flags: {
        [UpgradeFlags.STABLE]: 'Install the latest stable release; the default',
        [UpgradeFlags.NIGHTLY]: 'Install the higher of latest and next',
      },
      positionals: 1,
      exits:
        '0 on success; 1 when --stable and --nightly are both given, the dist-tags cannot be read, or the install or sync fails.',
    },
    [VulcanCommands.CHANGELOG]: {
      help: `  changelog check                 Check the changelog entries' \`migration\` blocks: a Breaking Change entry
                                  dated on or after knowledge.migrationFrom must carry one, and every block must be valid`,
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 when every entry conforms; 1 when an entry does not, the tool is missing or the configuration is invalid; 2 for a subcommand other than check.',
    },
    [VulcanCommands.X]: {
      help: `  x <tool> [args...]              Run a shipped tool at the pinned version: okf, atlas`,
      passthrough: true,
      exits:
        'the exit code of the tool; 1 on a missing or unknown tool, an unresolvable package or an invalid configuration',
    },
    [VulcanCommands.HELP]: { help: '', passthrough: true, exits: '0' },
    [VulcanCommands.VERSION]: { help: '', passthrough: true, exits: '0' },
  };

  /** The arguments the router lets `name` take; undefined when it checks none. */
  static accepted(opts: { name: string }): IAcceptedArgs | undefined {
    const spec = CommandTable.COMMANDS[opts.name];

    if (spec === undefined || spec.passthrough === true) {
      return undefined;
    }

    return {
      flags: [...Object.keys(spec.flags ?? {}), ...(spec.ignored?.flags ?? [])],
      values: [...Object.keys(spec.values ?? {}), ...(spec.ignored?.values ?? [])],
      positionals: spec.positionals ?? 0,
      ...(spec.unknownExit === undefined ? {} : { unknownExit: spec.unknownExit }),
    };
  }

  /** What `vulcan help` prints. */
  static helpText(): string {
    const blocks = Object.values(CommandTable.COMMANDS).flatMap((spec) =>
      spec.help === '' ? [] : [spec.help],
    );

    return `vulcan ${VULCAN_VERSION} - one setup, one workflow for every project\n\nUsage: bun x vulcan <command>\n\n${blocks.join('\n')}\n  help · version\n`;
  }
}
