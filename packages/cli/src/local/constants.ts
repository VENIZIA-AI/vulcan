/** The state of one thing under `.agents/local/`, as `clean` and `doctor` read it. */
export class LocalStates {
  static readonly OK = 'ok';
  /** Older than its directory's `staleAfterDays`. */
  static readonly STALE = 'stale';
  /** A worktree whose branch is merged into the main checkout's branch. */
  static readonly MERGED = 'merged';
  /** A worktree whose branch no longer exists. */
  static readonly GONE = 'gone';
  /** A worktree whose branch is not merged: it is never removed by `clean`. */
  static readonly UNMERGED = 'unmerged';
  /** A folder in `worktrees/` that git does not list. */
  static readonly ORPHAN = 'orphan';
  /** A worktree on a merged or gone branch that still holds uncommitted or untracked files: never removed. */
  static readonly DIRTY = 'dirty';
  /** A release candidate whose version has been tagged: the release shipped, so it can go. */
  static readonly SHIPPED = 'shipped';
  /** git could not say (not a repository, or git is missing): left alone. */
  static readonly UNKNOWN = 'unknown';
}

/** What `vulcan clean` can be told to clear. The default is `tmp`; `all` never reaches the kept ones. */
export class CleanScopes {
  static readonly TMP = 'tmp';
  static readonly WORKTREES = 'worktrees';
  static readonly CLONES = 'clones';
  static readonly CACHE = 'cache';
  static readonly REPORTS = 'reports';
  static readonly PROTOTYPES = 'prototypes';
  static readonly PROFILE = 'profile';
  static readonly EVENTS = 'events';
  static readonly RELEASE_CANDIDATES = 'release-candidates';
  /** `--all`: what an agent creates and can recreate. Reports, prototypes, events, release candidates and the profile are named, never swept. */
  static readonly ALL = [this.TMP, this.WORKTREES, this.CLONES, this.CACHE];
  static readonly SCHEME_SET = new Set<string>([
    this.TMP,
    this.WORKTREES,
    this.CLONES,
    this.CACHE,
    this.REPORTS,
    this.PROTOTYPES,
    this.PROFILE,
    this.EVENTS,
    this.RELEASE_CANDIDATES,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class LocalConstants {
  static readonly DAY_MS = 24 * 60 * 60 * 1000;
  /** `doctor` prints the size of `.agents/local/` once it passes this. */
  static readonly NOTE_BYTES = 50 * 1024 * 1024;
  static readonly GIT_TIMEOUT_MS = 10_000;
  /** Files VULCAN itself writes directly under `.agents/local/`; anything else there that is not a layout folder is unknown. */
  static readonly KNOWN_FILES = new Set([
    'profile.json',
    'claude.launch.settings.json',
    'auto-clean.json',
    '.gitkeep',
  ]);
  /**
   * Scratch folders a browser leaves directly under the temp folder it was given (`.agents/local` when it is
   * the folder that is short enough for Chrome's socket). They are tmp that sits one level too high.
   */
  static readonly STRAY_TEMP = [/^\.?com\.google\.Chrome\./, /^\.?org\.chromium\.Chromium\./];
  /** Ignored folders a build or an install makes again; an ignored file outside these keeps a worktree. Data, not code. */
  static readonly REBUILDABLE_DIRECTORIES = [
    'node_modules',
    'dist',
    '.turbo',
    'coverage',
    '.cache',
  ];
  static readonly REBUILDABLE_SUFFIXES = ['.tsbuildinfo'];
  /** The name of a release candidate: a version, with an optional `v`. Any other name in `release-candidates/` is kept. */
  static readonly RELEASE_VERSION = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  /** How many entries of an ignored directory are looked at before it is reported whole. */
  static readonly IGNORED_WALK_LIMIT = 20_000;
  /** How many ignored files a note names before it says "and N more". */
  static readonly NOTE_FILES = 5;
  /** A stray folder may belong to a browser that is running; one this old does not. */
  static readonly STRAY_MIN_AGE_MS = 60 * 60 * 1000;
}

/** What `clean` and the automatic clean never take, because a live session is using it. */
export class LocalProtected {
  /** Claude Code's folder for the output of its background tasks: `tmp/claude-<uid>`. */
  static readonly CLAUDE_TASKS = /^claude-\d+$/;

  /** Why the item is never removed, or undefined when it may be. */
  static noteOf(opts: { scope: string; name: string }): string | undefined {
    if (opts.scope === CleanScopes.TMP && LocalProtected.CLAUDE_TASKS.test(opts.name)) {
      return "in use: Claude Code's background task output; never removed";
    }

    return undefined;
  }
}
