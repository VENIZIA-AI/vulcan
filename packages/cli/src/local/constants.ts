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
  /** `--all`: what an agent creates and can recreate. Reports, prototypes and the profile are named, never swept. */
  static readonly ALL = [this.TMP, this.WORKTREES, this.CLONES, this.CACHE];
  static readonly SCHEME_SET = new Set<string>([
    this.TMP,
    this.WORKTREES,
    this.CLONES,
    this.CACHE,
    this.REPORTS,
    this.PROTOTYPES,
    this.PROFILE,
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
}
