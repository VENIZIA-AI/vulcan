import { AgentConstants } from '../agents/index.ts';
import { BoardFlags } from '../board/common/index.ts';
import { CommitCheckFlags } from '../commit/common/index.ts';
import { ExitCodes, UpgradeFlags, VULCAN_VERSION, VulcanCommands } from '../common/index.ts';
import { CreateFlags } from '../create/common/index.ts';
import { EventFlags, EventTypes } from '../events/common/index.ts';
import { HelpText } from './help-text.ts';
import { CommandScopes } from './scopes.ts';

/** What the router lets through for a command: the flags that stand alone, the flags that take the next argument, and how many plain arguments. */
export interface IAcceptedArgs {
  flags: string[];
  /** The exit code for an argument the command does not take; `1` when absent. */
  unknownExit?: number;
  values: string[];
  positionals: number;
}

/** One usage of a command in its public words: `vulcan <command> <args>`, then what it does. */
export interface IUsage {
  /** The public words, the scope first: `project init`. */
  command: string;
  args: string;
  text: string;
}

/** One command: what `vulcan help` prints for it, what its flags do, and what its exit codes mean. */
export interface ICommandSpec {
  /** The usages `vulcan help` prints, each under the scope its words start with. */
  usage: IUsage[];
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
      usage: [
        {
          command: 'project init',
          args: '[--key <KEY>]',
          text: "Add the project layer. No existing file is overwritten; missing .gitignore lines and dev dependencies are added. --key is the project's flow key (2 to 8 uppercase letters or digits), read only for a new config; a terminal asks, else it is made from the name.",
        },
        {
          command: 'project init',
          args: '--preset <name|file:path> --project <name> --app <name> [--backend-dir <path> | --frontend-dir <path>] [--shared-dir <path>] [--scope <@scope>] [--key <KEY>]',
          text: 'Create a monorepo with its first app, from a framework preset. A terminal asks for a name the flags leave out.',
        },
      ],
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
        '0 on success; 1 when it refuses before writing or bun add fails; 2 on a bad --key without --preset; after writing, the code of the step that failed.',
    },
    [VulcanCommands.ADD]: {
      usage: [
        {
          command: 'package add',
          args: '--preset <name|file:path> (--app <name> | --lib <name> | --shared <name>) [--dir <folder>] [--scope <@scope>] [--backend-dir <path> | --frontend-dir <path>] [--api <app> | --no-api]',
          text: 'Add to the monorepo an app, a library other apps import (--lib) or a side-neutral package (--shared). A frontend app says which backend it proxies to; --dir is for a library or a shared package; --scope names the package @scope/<name>. A terminal asks for the kind and every name the flags leave out. A refusal writes nothing; an install or a check that fails later leaves the files.',
        },
      ],
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
      exits:
        '0 on success; 1 on a refusal, before the first write; after writing, the code of the step that failed.',
    },
    [VulcanCommands.PRESET]: {
      usage: [
        {
          command: 'package diff',
          args: '<package> [--preset <name|file:path>] [--api <app> | --no-api] [--full] [--check]',
          text: 'Set each file the preset makes now against the file the package has (same, differs, missing), and change no project file. --preset replaces the preset found from the package (name@range is fetched into .agents/tmp); --full prints the unified diffs; --check exits 1 when a file differs or is missing.',
        },
      ],
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
      usage: [
        {
          command: 'project sync',
          args: '[--agents <list>|list] [--dry-run] [--quiet]',
          text: 'Write the adapters of the agents you chose (--agents claude,omp or none, stored in .agents/local/profile.json; --agents list shows them), with their guards, the commit hook when a check is on and the ignore lines; move old profile keys to the new names. --dry-run writes nothing; --quiet prints only changes and notes.',
        },
      ],
      flags: {
        '--dry-run': 'Print planned changes without writing to disk',
        '--quiet': 'Print only what changed and the notes, not every file that stayed as it was',
      },
      values: {
        [AgentConstants.FLAG]: 'The agents to write adapters for, comma-separated, none, or list',
      },
      exits:
        '0 on success; 1 when the config fails to load, the agent choice cannot be resolved or .claude/settings.json is not a JSON object.',
    },
    [VulcanCommands.AGENTS]: {
      usage: [
        {
          command: 'agent list',
          args: '',
          text: 'List the coding agents and which of them you chose on this machine; vulcan agent alone does the same.',
        },
        {
          command: 'agent add',
          args: '<id,id> [--dry-run]',
          text: 'Add agents, given as one comma-separated list.',
        },
        {
          command: 'agent remove',
          args: '<id,id> [--dry-run]',
          text: 'Remove agents, given as one comma-separated list.',
        },
        {
          command: 'agent setup',
          args: '[--dry-run]',
          text: 'Choose your agents again; needs a terminal. --dry-run writes nothing.',
        },
      ],
      flags: {
        '--dry-run': 'Print what would change and write nothing',
      },
      positionals: 2,
      exits:
        '0 on success, including an agent already chosen or not chosen; 1 on an unknown id, a bad argument or a failed write; 2 on an unknown action.',
    },
    [VulcanCommands.DOCTOR]: {
      usage: [
        {
          command: 'project doctor',
          args: '',
          text: 'Check the project follows VULCAN; exit 1 on any violation.',
        },
      ],
      exits: '0 for a conformant project; 1 on one or more contract violations.',
    },
    [VulcanCommands.COMMIT_CHECK]: {
      usage: [
        {
          command: 'check commit',
          args: '<message-file> | --range <revs> | --text <message>',
          text: 'Check a commit message against check.commit.message as the last sync recorded it (an agent signature, the subject shape); with no record, agent signatures are refused. sync installs it as the commit-msg hook when a check is on and no other hook is there. Exit 1 on a problem, 2 on bad input.',
        },
      ],
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
      usage: [
        {
          command: 'board show',
          args: '[--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo <owner/name>]... [--no-github]',
          text: 'Fold the event log, with the pull or merge requests gh or glab can read, into flows and write one HTML file (default .agents/local/reports/board.html), from the last 7 days unless --since says otherwise. --repo names the repositories to read; --no-github reads neither GitHub nor GitLab. Exit 2 on bad input.',
        },
        {
          command: 'board serve',
          args: '[--port <n>] [--open] [--since <date>] [--dir <events folder>] [--repo <owner/name>]... [--no-github]',
          text: 'Serve the same page on 127.0.0.1 and push new events to it with no reload. The port is 4317, or a free one when that is busy; a busy --port fails.',
        },
      ],
      flags: {
        [BoardFlags.OPEN]: 'Open the file in your browser when it is written',
        [BoardFlags.NO_GITHUB]: 'Read neither GitHub nor GitLab',
      },
      values: {
        [BoardFlags.OUT]: 'The file to write; default .agents/local/reports/board.html',
        [BoardFlags.PORT]: 'serve only: the port to listen on; default 4317',
        [BoardFlags.SINCE]:
          'Read events and pull requests changed at or after this date; default 7 days ago',
        [BoardFlags.DIR]: 'The events folder; default board.events.dir, else .agents/local/events',
        [BoardFlags.REPO]:
          'A GitHub or GitLab repository, such as owner/name; repeat it to read several',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 on written or serve stopped; 1 when the file cannot be written or serve cannot start; 2 on bad input.',
    },
    [VulcanCommands.EVENT]: {
      usage: [
        {
          command: 'flow add',
          args: '--title <text> [--flow <flow id>] [--why <text>] [--context <text>] [--next <text>] [--step <text>]... [--step-done <text>]... [--check <text>]... [--check-done <text>]... [--app <name>]... [--due <YYYY-MM-DD>] [--order <n>|none] [--ref <ref>] [--actor <name>] [--dir <folder>]',
          text: 'Open a flow and print its id; with --flow, write a new line for that flow.',
        },
        {
          command: 'flow step',
          args: '[--done <step>... | --todo <step>...] [--next <text>] [--context <text>] [--order <n>|none] [--flow <flow id>] [--actor <name>] [--dir <folder>]',
          text: "Change steps, the next step, the context or the order of a flow (--flow, else the branch's flow) and keep the rest; give at least one change. The event scope also takes it, as step.",
        },
        {
          command: 'event add',
          args: '--type <type> --summary <text> [--flow <flow id>] [--ref <ref>] [--status approve|park|reject] [--actor <name>] [--dir <folder>]',
          text: `Write one event to the event log (.agents/local/events/events.db). Types: ${Object.values(
            EventTypes,
          )
            .filter((value) => typeof value === 'string')
            .join(
              ', ',
            )}. --status is required on a decision and refused elsewhere. With board.events.log on, sync installs the Claude Code hooks that write the log. Exit 2 on bad input.`,
        },
        {
          command: 'event tail',
          args: '[--since <time>] [--json] [--dir <folder>]',
          text: 'Print the events since a time (default: the last 24 hours); --json prints each as JSON.',
        },
        {
          command: 'event import',
          args: '[--dir <folder>]',
          text: 'Load the day files of an earlier release (<day>.jsonl) into events.db. The files stay; an event that is already there is not added again.',
        },
      ],
      flags: {
        [EventFlags.JSON]: 'tail only: print each event as JSON',
      },
      values: {
        [EventFlags.TYPE]: 'One of the fourteen event kinds',
        [EventFlags.SUMMARY]: 'A short label, cut to one line of 200 characters',
        [EventFlags.FLOW]: 'The id of a flow the log already has',
        [EventFlags.DONE]: 'step: set this step of the flow done (added when it is not there)',
        [EventFlags.TODO]: 'step: set this step of the flow open (added when it is not there)',
        [EventFlags.STEP]: 'Flow only, repeatable: a step still to do',
        [EventFlags.STEP_DONE]: 'Flow only, repeatable: a step done',
        [EventFlags.CHECK]: 'Flow only, repeatable: an acceptance check still open',
        [EventFlags.CHECK_DONE]: 'Flow only, repeatable: an acceptance check done',
        [EventFlags.APP]: 'Flow only, repeatable: an app or module the flow touches',
        [EventFlags.DUE]: 'Flow only: the day it is due, YYYY-MM-DD',
        [EventFlags.ORDER]:
          'Flow only: its place in the work order, a positive whole number; none clears it',
        [EventFlags.REF]: 'A commit, a PR number, a recipient, or a tracker id',
        [EventFlags.STATUS]: 'approve, park or reject; required on a decision',
        [EventFlags.TITLE]: 'Flow only, required: the title of the flow',
        [EventFlags.WHY]: 'Flow only: one line on why the flow exists',
        [EventFlags.CONTEXT]: 'Flow only: what the flow is, up to 600 characters',
        [EventFlags.NEXT]: 'Flow only: the next step and who does it',
        [EventFlags.ACTOR]: 'Who wrote the event; else VULCAN_ACTOR or the session name',
        [EventFlags.DIR]: 'The events folder for this call, over board.events.dir',
        [EventFlags.SINCE]: 'tail only: print events at or after this time; default 24 hours',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 when written, printed or already so; 1 when the log cannot be written or read; 2 on bad input.',
    },
    [VulcanCommands.VISUALIZE]: {
      usage: [
        {
          command: 'page new',
          args: '<spec.json> [--out <name>]',
          text: 'Make one static HTML page (a flow, a status, a before and after) from a JSON spec, in .agents/local/prototypes/ under the current folder.',
        },
        { command: 'page schema', args: '', text: 'Print the schema of the spec.' },
      ],
      ignored: { flags: ['--schema'], values: [] },
      values: {
        [BoardFlags.OUT]: 'The name of the page written in .agents/local/prototypes/',
      },
      positionals: 1,
      exits:
        '0 on success; 1 when the spec is missing or not renderable, or .agents/local/ is missing or outside the project.',
    },
    [VulcanCommands.PROFILE]: {
      usage: [
        {
          command: 'profile edit',
          args: '',
          text: 'Say how you like to work (reply language, how to address you, tone, habits), saved in .agents/local/profile.json; vulcan profile alone does the same.',
        },
        { command: 'profile show', args: '', text: 'Print your profile.' },
        {
          command: 'profile reset',
          args: '[--yes]',
          text: 'Show what removing your answers would do; --yes removes them. The machine settings (agent, board, common) stay.',
        },
      ],
      flags: {
        '--yes':
          "With reset: remove your answers; this machine's valid settings (agent, board, common) stay, and the file goes only when none is left",
      },
      positionals: 1,
      exits:
        '0 on saved, shown, reset or nothing to reset; 1 on cancelled, unreadable profile, .agents/local/ not gitignored, or unknown argument.',
    },
    [VulcanCommands.CONFIG]: {
      usage: [
        {
          command: 'config effective',
          args: '',
          text: 'Print the config the commands read (the shipped defaults, the config of each pack, then the project file, merged) and the layer each value came from. Read-only; exit 1 when the config cannot be loaded, 2 on bad input.',
        },
        {
          command: 'config diff',
          args: '',
          text: 'List the values of the project file that the shipped layers already give. Read-only; exit 1 when the config cannot be loaded, 2 on bad input.',
        },
        {
          command: 'config codemod',
          args: 'config-groups [<dir>] [--split] [--write] [--reverse]',
          text: 'Move the keys of a flat config into the seven groups, renaming those a group names differently, with their comments. --split makes one module per group in .configs/vulcan/ and deletes the modules it folds in. Without --write it lists what it would write. Exit 2, with nothing written, when it cannot move something without losing it. --reverse changes nothing, says the move is not reversible (restore the config from git) and exits 2.',
        },
        {
          command: 'config codemod',
          args: 'type-names [<dir>] [--write] [--reverse]',
          text: 'Rename kind to type and presetKind to presetType in package entries, and kinds to types in acknowledgements, in the config and the standard modules of .configs/vulcan/. Without --write it lists what it would write. --reverse as above.',
        },
        { command: 'config codemod', args: '--list', text: 'Name the codemods.' },
        {
          command: 'config format',
          args: '[--check]',
          text: 'Put the top-level keys of .configs/vulcan.config.mts in the canonical order, and in a grouped file the keys inside each group written as a literal (not guard), each with its comments. --check writes nothing and exits 1 when a key would move. Exit 2 when the keys cannot be ordered (a spread, a computed key, two keys on one line, no object literal).',
        },
      ],
      ignored: { flags: ['--effective', '--diff'], values: [] },
      flags: {
        '--check': 'format only: write nothing; exit 1 and name the keys that would move',
        '--write': 'codemod only: write the files (without it, list them)',
        '--split': 'codemod only: one module per group under .configs/vulcan/',
        '--list': 'codemod only: name the codemods',
        '--reverse': 'codemod only: changes nothing; the codemods are not reversible',
      },
      positionals: 3,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 on shown, written, listed, already in order or nothing to do; 1 when the config cannot be loaded, or with --check when a key would move; 2 on bad input, no config to format, a config that cannot be ordered or moved, or codemod --reverse.',
    },
    [VulcanCommands.CLEAN]: {
      usage: [
        {
          command: 'project clean',
          args: '[--tmp] [--worktrees] [--clones] [--cache] [--all] [--reports] [--prototypes] [--events] [--release-candidates] [--profile] [--include-fresh] [--yes]',
          text: 'List what agents left in the tmp folder, .agents/local/ and the events folder; --yes removes it. --tmp, the default, takes items older than a day; --clones those older than two weeks; --include-fresh adds the newer ones. --worktrees takes clean worktrees whose branch is merged or gone, and folders git does not list. --cache is what atlas fetched. --all means tmp, worktrees, clones and cache. --reports, --prototypes, --events, --release-candidates and --profile are taken only when named.',
        },
      ],
      flags: {
        '--tmp': 'Remove the stale items of tmp/ (older than a day); the default',
        '--include-fresh':
          'Also remove items of tmp/ and clones/ that are not stale yet; a live session may be using them',
        '--worktrees': 'Remove worktrees whose branch is merged or gone and that are clean',
        '--clones': 'Remove stale clones of other repositories (older than two weeks)',
        '--cache': 'Remove what atlas fetched; it rebuilds',
        '--reports': 'Remove reports/; kept unless named',
        '--prototypes': 'Remove prototypes/; kept unless named',
        '--profile':
          "Reset profile.json like 'vulcan profile reset': your answers go, this machine's keys stay; kept unless named",
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
      usage: [
        {
          command: 'project upgrade',
          args: '[--stable | --nightly] [<version|tag>]',
          text: 'Pin another @venizia/vulcan, then sync. A version or tag you give wins. Without a flag it installs the latest tag, and refuses when that is older than the installed prerelease or cannot be read then; --stable installs latest anyway; --nightly installs the higher of latest and next.',
        },
      ],
      flags: {
        [UpgradeFlags.STABLE]: 'Install the latest stable release, even over a newer prerelease',
        [UpgradeFlags.NIGHTLY]: 'Install the higher of latest and next',
      },
      positionals: 1,
      exits:
        '0 on success; 1 when --stable and --nightly are both given, --nightly cannot read the dist-tags, latest would downgrade a prerelease without --stable, or no bin was installed; else the code of bun add or sync.',
    },
    [VulcanCommands.RUNNERS]: {
      usage: [
        {
          command: 'check runners',
          args: '',
          text: 'List the tracked files that run an unscoped package through bunx, pnpx, bun x, npx, npm exec, npm x, npm init, npm create, bun create, bun add -g, pnpm dlx, pnpm create, yarn dlx or yarn create, with or without no-install (npm may give the name to someone else). A scoped package passes, as do the names of guard.runners.allow as sync recorded them. Tests, lockfiles, build output, vendored and fixture folders, binaries, files over 1 MiB, released changelogs and lines marked as examples are not read. Exit 1 on a finding.',
        },
      ],
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 when no file runs one; 1 when one does (file:line, the command and the safe forms); 2 for any other argument or a folder git cannot list.',
    },
    [VulcanCommands.LAYOUT]: {
      usage: [
        {
          command: 'check layout',
          args: '[--write-baseline]',
          text: 'List the layout findings of the package and layout folders (check.layout), or of the src folders when none is named: a plural role in a file name, a folder with loose files beside check.layout.minSubfolders (default 3) or more subfolders, a source file over check.layout.maxLines (default 600; a test file is not counted). A finding in .configs/vulcan/layout/baseline.json passes; any other exits 1, except a long file, which is a warning only. --write-baseline writes every finding into that file.',
        },
      ],
      flags: {
        '--write-baseline':
          'Write every finding into .configs/vulcan/layout/baseline.json instead of listing them',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 when every finding is in the baseline (or the baseline was written); 1 when one is not, or the check cannot run (the config, the baseline, a folder outside git, a listing git does not give); 2 on bad arguments.',
    },
    [VulcanCommands.CHANGELOG]: {
      usage: [
        {
          command: 'check changelog',
          args: '[--history --base <ref>]',
          text: 'Check the changelog folder. Every version folder changelogs/<X.Y.Z>/ must be valid and give each Breaking and Deprecated item a migration block. When knowledge.migrationFrom is a date, a dated entry from that day on that says Breaking Change needs a block too. No dated entry may be later than knowledge.datedUntil. Each codemod an item names must be one the codemod runner lists. --history compares with --base: a released folder must not change, and when migrationFrom is a version, every stable release needs a folder and no late dated entry may be added or edited.',
        },
        {
          command: 'migrate notes',
          args: '--version <X.Y.Z> [--migration]',
          text: 'Print the release notes of a version folder: the body of its log.md, then the packages. --migration prints instead the path of its migration.yaml when that file holds a block or cannot be read as YAML, and nothing otherwise.',
        },
      ],
      flags: {
        '--history':
          'Also run the checks that read git: frozen released folders, stables without a folder, new dated files',
        '--migration':
          'With notes: print the path of migration.yaml when it holds a block, not the notes',
      },
      values: {
        '--base':
          'With --history: the commit or branch the change is measured from, e.g. origin/develop',
        '--version': 'With notes: the version folder to read, e.g. 0.4.8',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        '0 when every entry conforms (notes: printed); 1 on a problem, codemod names that cannot be checked, a version folder notes cannot find, a missing tool or an invalid configuration; 2 on bad arguments.',
    },
    [VulcanCommands.MIGRATE]: {
      usage: [
        {
          command: 'migrate plan',
          args: '[--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json] [--verbose] [--root <dir>] [--source <owner/repo>@<ref>]... [--cache-dir <dir>] [--no-prebuilt]',
          text: 'Say what an app must change to move a package between two releases, newer or older: the steps in order, the places in your code (file:line), codemods and data warnings. Read-only. Without --package, --to is latest or next and --from is not allowed.',
        },
        {
          command: 'migrate apply',
          args: '[--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--force] [--root <dir>] [--source <owner/repo>@<ref>]... [--cache-dir <dir>] [--no-prebuilt]',
          text: 'Run the codemods the plan links, each once and in order, stage what they wrote when the app was clean, then print the steps that stay manual. It refuses, unless --force, an app with uncommitted changes or outside git (when there is a codemod), a source that is not served, a package behind npm and a degraded plan.',
        },
      ],
      values: {
        '--package': 'The package to move; absent, every installed package the sources know',
        '--from': 'The version the app runs now; default the installed one',
        '--to':
          'A version, latest (newest stable) or next (newest release) of the atlas release table',
        '--app': 'The app directory to scan; default the current directory',
        '--format': 'md (default) or json (plan only)',
        '--root': 'The project atlas serves the sources of; read by atlas',
        '--source': 'A source to serve, owner/repo@ref, repeatable; read by atlas',
        '--cache-dir': 'Where atlas keeps the sets it pulls; read by atlas',
      },
      flags: {
        '--no-prebuilt': 'Build the index from the files, do not download the prebuilt one',
        '--force': 'apply: run on an app with uncommitted changes, or outside git',
        '--verbose': 'plan: list every place that imports a module a step is about, not a count',
      },
      positionals: 1,
      unknownExit: ExitCodes.USAGE,
      exits:
        "0 when a plan is printed or apply ran; 1 when the plan cannot be made, apply is refused (uncommitted changes, no git, the source's codemod runner missing or not allowed) or a codemod fails, or the tool is missing; 2 on bad usage or when there is nothing to serve.",
    },
    [VulcanCommands.X]: {
      usage: [
        {
          command: 'okf <command>',
          args: '[<args>...]',
          text: 'The knowledge bundle tool: OKF conformance check, gen and coverage. Every argument, --help included, goes to the pinned tool.',
        },
        {
          command: 'atlas <command>',
          args: '[<args>...]',
          text: 'The MCP knowledge server over the wiki, changelogs and knowledge bundle. Every argument, --help included, goes to the pinned tool.',
        },
      ],
      passthrough: true,
      exits:
        'the exit code of the tool; 1 on a missing or unknown tool, an unresolvable package or an invalid configuration',
    },
    [VulcanCommands.HELP]: { usage: [], passthrough: true, exits: '0' },
    [VulcanCommands.VERSION]: { usage: [], passthrough: true, exits: '0' },
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

  /** What `vulcan <scope> --help` prints. */
  static scopeHelp(opts: { scope: string }): string {
    return `${HelpText.scope({ scope: opts.scope, usages: CommandTable.usages() })}\n`;
  }

  /** What `vulcan help` prints. */
  static helpText(): string {
    const usages = CommandTable.usages();
    const scopes = CommandScopes.scopes().map((scope) => HelpText.scope({ scope, usages }));

    return `vulcan ${VULCAN_VERSION} - one setup, one workflow for every project\n\nUsage: bun node_modules/.bin/vulcan <scope> <action>\n\n${scopes.join('\n\n')}\n\nAlso: vulcan help [<scope>], vulcan version\n`;
  }

  static usages(): IUsage[] {
    return Object.values(CommandTable.COMMANDS).flatMap((spec) => spec.usage);
  }
}
