import { EnvVariables } from './env-variables.ts';

/** The names of the `vulcan` subcommands, shared by the router, the command registry and the help output. */
export class VulcanCommands {
  static readonly INIT = 'init';
  static readonly ADD = 'add';
  static readonly SYNC = 'sync';
  static readonly AGENTS = 'agents';
  static readonly DOCTOR = 'doctor';
  static readonly UPGRADE = 'upgrade';
  static readonly CLEAN = 'clean';
  static readonly PROFILE = 'profile';
  static readonly PRESET = 'preset';
  static readonly VISUALIZE = 'visualize';
  static readonly COMMIT_CHECK = 'commit-check';
  static readonly CI = 'ci';
  static readonly BOARD = 'board';
  static readonly EVENT = 'event';
  static readonly GRAPH = 'graph';
  static readonly X = 'x';
  static readonly HELP = 'help';
  static readonly VERSION = 'version';
}

/** The release channels `vulcan upgrade` picks between; the channel is a flag, never stored in the config. */
export class UpgradeFlags {
  static readonly STABLE = '--stable';
  static readonly NIGHTLY = '--nightly';
  /** Tests only: a JSON object of dist-tags that stands in for the registry read. */
  static readonly DIST_TAGS_ENV = EnvVariables.VULCAN_DIST_TAGS;
}

export class ExitCodes {
  static readonly OK = 0;
  static readonly FAILURE = 1;
  /** A command that cannot run as asked: the arguments, a file or a range it cannot read. */
  static readonly USAGE = 2;
}

/** The tools `vulcan x` runs; each is a dependency of @venizia/vulcan at the exact same version. */
export class VulcanTools {
  static readonly OKF = 'okf';
  static readonly ATLAS = 'atlas';
  static readonly SCHEME_SET = new Set<string>([this.OKF, this.ATLAS]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** What a VULCAN project carries; shared by `init`, which writes it, and `doctor`, which checks it. */
export class ProjectLayout {
  /** How everything unattended runs vulcan: `--no-install` never fetches the unrelated npm package named `vulcan`. */
  static readonly VULCAN_COMMAND = 'bun x --no-install vulcan';

  /** `vulcan x` hands the resolved project config to the tool in these variables; the tools read nothing else. */
  static readonly CONFIG_ENV = EnvVariables.VULCAN_CONFIG;
  static readonly ROOT_ENV = EnvVariables.VULCAN_PROJECT_ROOT;
  /** `-include`: a fresh clone runs `make install` before node_modules exists. */
  static readonly MAKE_INCLUDE_LINE = '-include node_modules/@venizia/vulcan/base/make/vulcan.mk';
  static readonly STYLE_PACKAGE = '@venizia/dev-configs';
  /** The one list of secret files, for `.gitignore` and for `.dockerignore`: the `.env` files stay out of git and out of every image, the example stays in. */
  static readonly SECRET_PATTERNS = ['**/.env', '**/.env.*', '!**/.env.example'];
  /** The default `remoteHosts.localFile`: a person's own hosts, ignored by git. */
  static readonly TRUSTED_HOSTS_FILE = '.agents/hooks/trusted-hosts.local';
  static readonly GITIGNORE_ENTRIES = [
    'CLAUDE.md',
    'CLAUDE.*.md',
    '.claude/',
    '.agents/plans',
    '.agents/vulcan.local.json',
    '.agents/local/',
    ...ProjectLayout.SECRET_PATTERNS,
    ProjectLayout.TRUSTED_HOSTS_FILE,
  ];
  /** Everything an agent creates while it works lives under here, gitignored: nothing goes outside the project. */
  static readonly LOCAL_DIRECTORY = '.agents/local';
  /** Each directory under it, with when it goes: the one list `sync`, `doctor` and `clean` read. */
  static readonly LOCAL_LAYOUT = [
    { name: 'tmp', lifetime: 'task', removedWhen: 'the task ends', staleAfterDays: 1 },
    { name: 'worktrees', lifetime: 'branch', removedWhen: 'its branch is merged or abandoned' },
    {
      name: 'clones',
      lifetime: 'research',
      removedWhen: 'the research that needed them is reported',
      staleAfterDays: 14,
    },
    { name: 'cache', lifetime: 'kept', removedWhen: 'the user asks; it rebuilds' },
    { name: 'reports', lifetime: 'kept', removedWhen: 'the user deletes it' },
    { name: 'prototypes', lifetime: 'kept', removedWhen: 'the user deletes it' },
    // On demand: sync does not create these; the folder appears when something writes there.
    // `agents/<name>/` is the home of one agent's own state; `clean` never takes it.
    { name: 'agents', lifetime: 'kept', removedWhen: 'the user deletes it', onDemand: true },
    { name: 'events', lifetime: 'kept', removedWhen: 'the user deletes it', onDemand: true },
    {
      name: 'release-candidates',
      lifetime: 'release',
      removedWhen: 'the release ships',
      onDemand: true,
    },
  ] as const;
  /** What the scaffolded lint configs run; optional peers of dev-configs, so bun never installs them alone. */
  static readonly LINT_TOOLS = ['oxlint', 'oxlint-tsgolint', 'eslint'];
  /** Written into a scaffolded file the project must fill in; doctor fails the file while it holds this. */
  static readonly SCAFFOLD_MARKER = 'vulcan:scaffold';
}
