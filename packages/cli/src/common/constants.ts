export class VulcanCommands {
  static readonly INIT = 'init';
  static readonly ADD = 'add';
  static readonly SYNC = 'sync';
  static readonly AGENTS = 'agents';
  static readonly DOCTOR = 'doctor';
  static readonly UPGRADE = 'upgrade';
  static readonly X = 'x';
  static readonly HELP = 'help';
  static readonly VERSION = 'version';
  static readonly SCHEME_SET = new Set<string>([
    this.INIT,
    this.ADD,
    this.SYNC,
    this.AGENTS,
    this.DOCTOR,
    this.UPGRADE,
    this.X,
    this.HELP,
    this.VERSION,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The release channels `vulcan upgrade` picks between; the channel is a flag, never stored in the config. */
export class UpgradeFlags {
  static readonly STABLE = '--stable';
  static readonly NIGHTLY = '--nightly';
  /** Tests only: a JSON object of dist-tags that stands in for the registry read. */
  static readonly DIST_TAGS_ENV = 'VULCAN_DIST_TAGS';
  static readonly SCHEME_SET = new Set<string>([this.STABLE, this.NIGHTLY]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class ExitCodes {
  static readonly OK = 0;
  static readonly FAILURE = 1;
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
  static readonly CONFIG_ENV = 'VULCAN_CONFIG';
  static readonly ROOT_ENV = 'VULCAN_PROJECT_ROOT';
  /** `-include`: a fresh clone runs `make install` before node_modules exists. */
  static readonly MAKE_INCLUDE_LINE = '-include node_modules/@venizia/vulcan/base/make/vulcan.mk';
  static readonly STYLE_PACKAGE = '@venizia/dev-configs';
  static readonly GITIGNORE_ENTRIES = [
    'CLAUDE.md',
    'CLAUDE.*.md',
    '.claude/',
    '.agents/plans',
    '.agents/vulcan.local.json',
  ];
  /** What the scaffolded lint configs run; optional peers of dev-configs, so bun never installs them alone. */
  static readonly LINT_TOOLS = ['oxlint', 'oxlint-tsgolint', 'oxfmt', 'eslint'];
  /** Written into a scaffolded file the project must fill in; doctor fails the file while it holds this. */
  static readonly SCAFFOLD_MARKER = 'vulcan:scaffold';
}
