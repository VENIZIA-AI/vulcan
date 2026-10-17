export class VulcanCommands {
  static readonly INIT = 'init';
  static readonly SYNC = 'sync';
  static readonly DOCTOR = 'doctor';
  static readonly UPGRADE = 'upgrade';
  static readonly X = 'x';
  static readonly HELP = 'help';
  static readonly VERSION = 'version';
  static readonly SCHEME_SET = new Set<string>([
    this.INIT,
    this.SYNC,
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
  /** `-include`: a fresh clone runs `make install` before node_modules exists. */
  static readonly MAKE_INCLUDE_LINE = '-include node_modules/@venizia/vulcan/base/make/vulcan.mk';
  static readonly STYLE_PACKAGE = '@venizia/dev-configs';
  static readonly GITIGNORE_ENTRIES = ['CLAUDE.md', '.claude/'];
}
