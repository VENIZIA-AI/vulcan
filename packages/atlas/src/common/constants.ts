import { ConstClass } from './types';

export class AtlasConstants {
  static readonly SERVER_NAME = 'vulcan-atlas';
  /** The one MCP protocol version this server speaks; `initialize` answers it whatever the client asked. */
  static readonly PROTOCOL_VERSION = '2025-06-18';
  static readonly SEARCH_BUDGET_CHARS = 2000;
  static readonly GET_BUDGET_CHARS = 8000;
  static readonly SNIPPET_MAX_CHARS = 300;
  static readonly SEARCH_DEFAULT_LIMIT = 10;
  /**
   * The format of a source's built index (the rows its chunker produces and the table they sit in).
   * Bump it with any change to either: the format-lock test fails until you do. A cached or
   * downloaded index of another format is never read as if it were current.
   */
  static readonly INDEX_FORMAT = 3;
}

/** How atlas runs git: every call, local or remote, takes this environment. */
export class AtlasGit {
  /**
   * The transports git may use for a source: `https` and `ssh` carry the repository authenticated and
   * encrypted, `file` is a repository on this machine. `http` and `git://` are clear text with no
   * authentication, and `ext::` and `fd::` run a command: none of them is allowed, whatever URL a source names.
   * Set in the environment, it overrides any `protocol.*.allow` of the user's git configuration.
   */
  static readonly ALLOWED_PROTOCOLS = 'https:ssh:file';

  /** Built at each call: tests and callers change `process.env` (PATH among them) after load. Never prompts for credentials. */
  static buildEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: AtlasGit.ALLOWED_PROTOCOLS,
    };
  }
}

/** Every wait atlas puts on the network or on git: past its bound, a call counts as failed. */
export class AtlasTimeouts {
  /** `git ls-remote`, or the ref advertisement without git: a start never waits longer on a remote. */
  static readonly REF_LOOKUP_MS = 10_000;
  /** A clone, a fetch, a sparse checkout fetching the blobs its paths need. */
  static readonly GIT_TRANSFER_MS = 60_000;
  /** A tarball download - a source's commit, or a package version from npm. */
  static readonly DOWNLOAD_MS = 60_000;
  /** One request for a prebuilt index: the release listing, an envelope, a gz. */
  static readonly PREBUILT_MS = 30_000;
  /** git on a local repository - the tags and history the release table reads. */
  static readonly LOCAL_GIT_MS = 30_000;
}

export class Corpora extends ConstClass {
  static readonly WIKI = 'wiki';
  static readonly CHANGELOG = 'changelog';
  static readonly KNOWLEDGE = 'knowledge';
}

/** The `vulcan-atlas` subcommands: the MCP server, and the generators of the tables it serves. */
export class AtlasCommands extends ConstClass {
  static readonly MCP = 'mcp';
  static readonly SURFACE = 'surface';
  static readonly API = 'api';
  static readonly SYMBOLS = 'symbols';
  static readonly RELEASES = 'releases';
  static readonly CHANGELOGS = 'changelogs';
  static readonly MIGRATE = 'migrate';
  static readonly PULL = 'pull';
  static readonly INDEX = 'index';
  static readonly TOOLS = 'tools';
  static readonly STATUS = 'status';
  static readonly HELP = 'help';
}

/** Where a skill of the catalog comes from: the package ships it, or the project wrote it. */
export class SkillSources extends ConstClass {
  static readonly SHIPPED = 'shipped';
  static readonly PROJECT = 'project';
}

/** What a package of the project is: an app, or a library other apps import. */
export class PackageTypes extends ConstClass {
  static readonly APP = 'app';
  static readonly LIB = 'lib';
}

/** Which preset kind made a library: `lib` (may use the project's framework) or `shared` (depends on no framework). */
export class LibraryTypes extends ConstClass {
  static readonly LIB = 'lib';
  static readonly SHARED = 'shared';
}

/** The side of the stack an app of a preset is on. */
export class AppSides extends ConstClass {
  static readonly BACKEND = 'backend';
  static readonly FRONTEND = 'frontend';
}

/** What a source's corpus is read at: the release tag of the installed package, or the configured ref. */
export class SourcePins extends ConstClass {
  static readonly INSTALLED = 'installed';
  static readonly REF = 'ref';
}

export { LogLevels } from '@venizia/vulcan-okf';
