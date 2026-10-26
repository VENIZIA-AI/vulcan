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
  static readonly PRUNE = 'prune';
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
  static readonly SCHEME_SET = new Set<string>([
    this.CONFIG,
    this.LAYOUT,
    this.RULE_IDS,
    this.RULE_SLOTS,
    this.SKILLS,
    this.MAKE,
    this.HOOKS,
    this.ADAPTERS,
    this.STYLE,
    this.MANIFEST,
    this.TAGS,
    this.PRUNE,
    this.SCAFFOLD,
    this.APPS,
    this.SCRIPTS,
    this.AGENTS,
    this.DOCKERIGNORE,
    this.MCP,
    this.FORMAT,
    this.LOCAL,
    this.PROFILE,
    this.GUARDS,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
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
  /** Where each tool's config lives under `.configs/`; a file left directly in `.configs/` is told where it belongs. */
  static readonly LINT_CONFIG_FOLDERS: Record<string, string> = {
    oxlint: 'lints',
    eslint: 'lints',
  };
}
