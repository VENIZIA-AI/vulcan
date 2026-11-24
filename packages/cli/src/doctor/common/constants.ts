import { ConstClass } from '../../common/types.ts';

export class DoctorChecks {
  /** The config file: missing, unloadable or without a default export is an error, and the only check run then. */
  static readonly CONFIG = 'config';
  /** The required files (AGENTS.md, .agents/rules.md, knowledge bundle root); a missing one is an error. */
  static readonly LAYOUT = 'layout';
  /** Rule references in .agents/rules.md; one to a base rule the base does not carry is an error. */
  static readonly RULE_IDS = 'rule-ids';
  /** The rule slot choices in the config; an unknown option or a key that is not a slot is an error. */
  static readonly RULE_SLOTS = 'rule-slots';
  /** Skill names and lint: an error; a skill description with no "Use when" part is a warning. */
  static readonly SKILLS = 'skills';
  /** The Makefile include of vulcan.mk and clashes with shipped target names; a violation is an error. */
  static readonly MAKE = 'make';
  /** Project hooks in the config; one that registers a shipped hook path is an error. */
  /** Generated tool files, settings and links against the config; a missing or stale one is an error. */
  static readonly ADAPTERS = 'adapters';
  /** Packages declare @venizia/dev-configs and lint configs import the shared style; a miss is an error. */
  static readonly STYLE = 'style';
  /** The local manifest and the committed descriptor against the config; a missing or outdated one is an error. */
  static readonly MANIFEST = 'manifest';
  /** Version folders under the changelog directory while the installed vulcan predates the atlas that reads them; an error. */
  static readonly CHANGELOG_FOLDERS = 'changelog-folders';
  /** Git tags matching atlas.tagPattern that name no declared package, alias or ignored tag; an error. */
  static readonly TAGS = 'tags';
  /** Workspaces declare packages and the knowledge index no longer holds scaffold text; a miss is an error. */
  static readonly SCAFFOLD = 'scaffold';
  /** Layout folders are workspaces and every package lives in a listed folder; a miss is an error. */
  static readonly APPS = 'apps';
  /** The stored agents file must parse and name known agents (an error); a stale Atlas block in AGENTS.md is a note. */
  static readonly AGENTS = 'agents';
  /** The .mcp.json atlas entry, its git visibility and the Claude settings that enable atlas; a warning. */
  static readonly MCP = 'mcp';
  /** The bunfig.toml [fmt] oxfmt setup, no fmt script and no leftover oxfmt config; a warning. */
  static readonly FORMAT = 'format';
  /** The .agents/local workspace, leftovers, reply switch and the tmp folder: mostly warnings, some notes. */
  static readonly LOCAL = 'local';
  /** The personal profile file: unreadable, not gitignored or tracked by git; a warning. */
  static readonly PROFILE = 'profile';
  /** The clone commit-msg hook when a commit check is on: missing, stale or not calling commit-check; a warning. */
  static readonly COMMIT_HOOK = 'commit-hook';
  /** The events.dir folder when outside the project: missing, not a folder or not writable; a warning. */
  static readonly EVENTS_DIR = 'events-dir';
  /** Today's event file when it alone is over events.maxSize; a warning. */
  static readonly EVENTS_SIZE = 'events-size';
  /** The event log is on but project.key is unset, so no flow can be created; a warning. */
  static readonly PROJECT_KEY = 'project-key';
  /** An atlas source the last server run could not build, or has been building for over ten minutes; a warning. */
  static readonly ATLAS_SOURCE = 'atlas-source';
  /** The root `package.json` has no `prepare` script that runs `vulcan sync`: a fresh clone has no manifest and no hooks until someone runs it; a note. */
  static readonly PREPARE = 'prepare';
  /** Git tracks `.claude/settings.json`: sync writes it in every clone, so it is never committed; a warning. */
  static readonly CLAUDE_SETTINGS = 'claude-settings';
  /** `board.serve.autoStart` is on but the event log is off, so nothing starts the board; a note. */
  static readonly BOARD_AUTOSTART = 'board-autostart';
  /** Lines of the config that repeat what the shipped defaults give; a note. */
  static readonly CONFIG_DEFAULTS = 'config-defaults';
  /** A `remove` entry that matches nothing: a stale opt-out; a warning. */
  static readonly CONFIG_REMOVE = 'config-remove';
  /** A workspace member of the root `package.json` that the config's `packages` list does not name; a warning. */
  static readonly WORKSPACE_PACKAGES = 'workspace-packages';
  /** Tracked files holding keys, tokens, URL credentials, IPv4 or machine paths: a warning; the count of acknowledged files: a note. */
  static readonly PRIVATE_VALUES = 'private-values';
}

/** What `vulcan doctor` looks for in committed files. */
export class PrivateValueKinds extends ConstClass {
  static readonly PRIVATE_KEY = 'private-key';
  static readonly TOKEN = 'token';
  static readonly URL_CREDENTIALS = 'url-credentials';
  static readonly IPV4 = 'ipv4';
  static readonly MACHINE_PATH = 'machine-path';
}

export class PrivateValueScan {
  /** An address standing on its own: no letter, digit, `_`, `.`, `-` or `,` touches it, so numbers of SVG path data and versions are not one. */
  static readonly IPV4 =
    /(?<![\w.,-])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.,-])/g;
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

export class DoctorConstants {
  /** The first VULCAN version whose atlas reads version folders (the first prerelease of the line to carry the reader); an older installed vulcan ignores them. */
  static readonly CHANGELOG_FOLDERS_FROM = '0.4.10-16';
  static readonly MAKE_INCLUDE_PATTERN =
    /^-?include\s+\S*@venizia\/vulcan\/base\/make\/vulcan\.mk\s*$/m;
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
