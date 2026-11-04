export class DoctorChecks {
  static readonly CONFIG = 'config';
  static readonly LAYOUT = 'layout';
  static readonly RULE_IDS = 'rule-ids';
  static readonly RULE_SLOTS = 'rule-slots';
  static readonly SKILLS = 'skills';
  static readonly MAKE = 'make';
  static readonly HOOKS = 'hooks';
  static readonly ADAPTERS = 'adapters';
  static readonly STYLE = 'style';
  static readonly MANIFEST = 'manifest';
  static readonly TAGS = 'tags';
  static readonly SCAFFOLD = 'scaffold';
  static readonly APPS = 'apps';
  static readonly SCRIPTS = 'scripts';
  static readonly AGENTS = 'agents';
  static readonly DOCKERIGNORE = 'dockerignore';
  static readonly MCP = 'mcp';
  static readonly FORMAT = 'format';
  static readonly LOCAL = 'local';
  static readonly PROFILE = 'profile';
  static readonly GUARDS = 'guards';
  static readonly COMMIT_HOOK = 'commit-hook';
  static readonly EVENTS_DIR = 'events-dir';
  static readonly EVENTS_SIZE = 'events-size';
  static readonly PROJECT_KEY = 'project-key';
  static readonly PRIVATE_VALUES = 'private-values';
}

/** What `vulcan doctor` looks for in committed files. */
export class PrivateValueKinds {
  static readonly PRIVATE_KEY = 'private-key';
  static readonly TOKEN = 'token';
  static readonly URL_CREDENTIALS = 'url-credentials';
  static readonly IPV4 = 'ipv4';
  static readonly MACHINE_PATH = 'machine-path';

  static readonly SCHEME_SET = new Set<string>([
    this.PRIVATE_KEY,
    this.TOKEN,
    this.URL_CREDENTIALS,
    this.IPV4,
    this.MACHINE_PATH,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class PrivateValueScan {
  /** An address, not part of a longer dotted number. */
  static readonly IPV4 =
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
  /** Loopback, any, broadcast and the three documentation ranges: no machine is named. */
  static readonly ALLOWED_IPV4 = [
    /^127\./,
    /^0\./,
    /^255\./,
    /^192\.0\.2\./,
    /^198\.51\.100\./,
    /^203\.0\.113\./,
  ];
  static readonly MACHINE_PATH =
    /\/home\/[a-z_][\w.-]*\/|\/Users\/[A-Za-z_][\w.-]*\/|[A-Za-z]:\\Users\\[\w.-]+\\/g;
  /** Lockfiles, diagrams, snapshots, tests and fixtures hold hashes and fake values on purpose. */
  static readonly SKIPPED_PATHS = [
    /(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
    /\.(drawio|snap)$/,
    /(^|\/)(__tests__|fixtures|golden)\//,
    /\.test\.[^/]*$/,
  ];
  static readonly MAX_BYTES = 1_000_000;
}

/** The `package.json` scripts every app carries, and the names the standard retired. */
export class AppScripts {
  static readonly STANDARD = [
    'server:dev',
    'compile',
    'typecheck',
    'lint',
    'lint:fix',
    'test',
    'clean',
  ];
  static readonly LEGACY = ['dev', 'start', 'build', 'rebuild', 'preview', 'server:prod'];
}

export class DoctorConstants {
  static readonly MAKE_INCLUDE_PATTERN =
    /^-?include\s+\S*@venizia\/vulcan\/base\/make\/vulcan\.mk\s*$/m;
  static readonly SHIPPED_HOOKS_PATH = '@venizia/vulcan/base/hooks/';
  /** The `[fmt]` table header of a `bunfig.toml`, on a line of its own, a trailing comment allowed. */
  static readonly BUNFIG_FMT_SECTION = /^\s*\[fmt\]\s*(#.*)?$/m;
  static readonly BUNFIG_FMT_FLAVOR = /^\s*flavor\s*=\s*["']oxfmt["']/m;
  /** What init wrote before `[fmt]` decided the style; `bun fmt` no longer reads it. */
  static readonly OXFMT_CONFIG_FILE = /^oxfmt\.config\.(mts|ts|mjs|js|cjs)$/;
  /** The oxfmt config names `bun fmt` finds by itself, in a package folder or above it; they override `[fmt]`. */
  static readonly OXFMT_AUTOLOADED_FILES = ['.oxfmtrc.json', '.oxfmtrc.jsonc', 'oxfmt.config.ts'];
  static readonly LINT_CONFIG_FILE = /^(oxlint|eslint)\.config\.(mts|ts|mjs|js|cjs)$/;
  /** Where the lint configs live under `.configs/`. */
  static readonly LINT_CONFIG_FOLDER = 'lints';
}
