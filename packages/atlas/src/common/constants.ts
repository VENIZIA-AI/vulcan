/** MCP protocol versions this server negotiates `initialize` against, newest first. */
export class ProtocolVersions {
  static readonly NEWEST = '2025-06-18';
  static readonly V2025_03_26 = '2025-03-26';
  static readonly V2024_11_05 = '2024-11-05';
  static readonly SCHEME_SET = new Set<string>([this.NEWEST, this.V2025_03_26, this.V2024_11_05]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class AtlasConstants {
  static readonly SERVER_NAME = 'vulcan-atlas';
  static readonly PROTOCOL_VERSION = ProtocolVersions.NEWEST;
  static readonly SEARCH_BUDGET_CHARS = 2000;
  static readonly GET_BUDGET_CHARS = 8000;
  static readonly SNIPPET_MAX_CHARS = 300;
  static readonly SEARCH_DEFAULT_LIMIT = 10;
}

/** Every wait atlas puts on the network or on git: past its bound, a call counts as failed. */
export class AtlasTimeouts {
  /** `git ls-remote`, or the ref advertisement without git: a start never waits longer on a remote. */
  static readonly REF_LOOKUP_MS = 10_000;
  /** A clone, a fetch, a sparse checkout fetching the blobs its paths need. */
  static readonly GIT_TRANSFER_MS = 60_000;
  /** A tarball download - a source's commit, or a package version from npm. */
  static readonly DOWNLOAD_MS = 60_000;
  /** git on a local repository - the tags and history the release table reads. */
  static readonly LOCAL_GIT_MS = 30_000;
}

export class AtlasModes {
  static readonly REPOSITORY = 'repo';
  static readonly SCHEME_SET = new Set<string>([this.REPOSITORY]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class Corpora {
  static readonly WIKI = 'wiki';
  static readonly CHANGELOG = 'changelog';
  static readonly KNOWLEDGE = 'knowledge';
  static readonly SCHEME_SET = new Set<string>([this.WIKI, this.CHANGELOG, this.KNOWLEDGE]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The `vulcan-atlas` subcommands: the MCP server, and the generators of the tables it serves. */
export class AtlasCommands {
  static readonly MCP = 'mcp';
  static readonly SURFACE = 'surface';
  static readonly SYMBOLS = 'symbols';
  static readonly RELEASES = 'releases';
  static readonly CHANGELOGS = 'changelogs';
  static readonly CONCEPTS = 'concepts';
  static readonly PULL = 'pull';
  static readonly SCHEME_SET = new Set<string>([
    this.MCP,
    this.SURFACE,
    this.SYMBOLS,
    this.RELEASES,
    this.CHANGELOGS,
    this.CONCEPTS,
    this.PULL,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The levels a log line carries; `emerg` is never a configured threshold. */
export class LogLevels {
  static readonly DEBUG = 'debug';
  static readonly INFO = 'info';
  static readonly WARN = 'warn';
  static readonly ERROR = 'error';
  static readonly EMERG = 'emerg';

  static readonly SCHEME_SET = new Set<string>([
    this.DEBUG,
    this.INFO,
    this.WARN,
    this.ERROR,
    this.EMERG,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}
