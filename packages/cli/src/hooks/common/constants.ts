/** What the guard asks Claude Code to do with a flagged command: ask the human, or refuse outright. */
export class GuardDecisions {
  static readonly ASK = 'ask';
  static readonly DENY = 'deny';
}

/** What the package guard says about a hand-made package: refuse where a `vulcan add` command exists, else warn. */
export class PackageVerdictKinds {
  static readonly DENY = GuardDecisions.DENY;
  static readonly WARN = 'warn';
}

/** What git says about a script a project trusts: only `TRUSTED` skips the script checks of guard-writes. */
export class TrustStates {
  static readonly TRUSTED = 'trusted';
  static readonly MISSING = 'missing';
  static readonly UNTRACKED = 'untracked';
  static readonly UNCOMMITTED = 'uncommitted';
  static readonly MODIFIED = 'modified';
  static readonly SYMLINK = 'symlink';
  static readonly UNKNOWN = 'unknown';
}

export class HookConstants {
  /** `ask` until the transcript shows the guard does not over-fire; a false positive costs one keystroke. */
  static readonly GUARD_DECISION = GuardDecisions.ASK;
  static readonly PRE_TOOL_USE = 'PreToolUse';
  /** Cursor sets it for every hook it runs, including the Claude hooks it imports; Claude Code never does. */
  static readonly CURSOR_PROJECT_DIR_ENV = 'CURSOR_PROJECT_DIR';
  static readonly SUBAGENT_START = 'SubagentStart';
  /** `git` and `gh` queries the guards make; a slow one is dropped and the command passes. */
  static readonly QUERY_TIMEOUT_MS = 5000;
  /** The `git` and `gh` queries one command line may make; past it the guard asks instead of querying on. */
  static readonly MAX_QUERIES = 4;
  /** A local script guard-writes reads is at most this many bytes; a larger one is not read, and the command asks. */
  static readonly MAX_SCRIPT_BYTES = 1_000_000;
  /** How many scripts deep guard-writes follows a script that runs another one; past it the command asks. */
  static readonly MAX_SCRIPT_DEPTH = 3;
  /**
   * A blanket stage (`git add -A`, `git commit -a`) asks past this many changed paths. A formatter run once put 152
   * unintended files into one commit; on this repository's develop the median commit touches 7 files and 2.2% touch more than 50.
   */
  static readonly BLANKET_STAGE_PATHS = 50;
  /** Branches no agent deletes or force-pushes (V-W-06). */
  static readonly PROTECTED_BRANCHES = new Set(['develop', 'main']);
  /**
   * Where a session's temporary files go, from the project root: `ProjectLayout.LOCAL_DIRECTORY` and `tmp`.
   * Spelt out here because the blocking hooks import nothing that reads the package (a test holds the two equal).
   */
  static readonly PROJECT_TMP = '.agents/local/tmp';
  /**
   * The scratchpad folder an agent tool offers a session sits under the system temp directory (Claude Code:
   * `/tmp/claude-<uid>/<project>/<session>/scratchpad`), so guard-outside denies a write there instead of asking.
   * The folder itself and everything below it; the tool's sibling folders (`tasks`) are not covered.
   * Only this Linux path is covered; another system's folder was not verified.
   */
  static readonly AGENT_TOOL_SCRATCHPAD_PATTERNS = [
    '/tmp/claude-[0-9]*/*/*/scratchpad',
    '/tmp/claude-[0-9]*/*/*/scratchpad/**',
  ];
  /**
   * Tool-owned stores an agent may write into: package manager caches, the runtime dir for locks, the
   * agent tool's memory. Never a directory on PATH (`~/.bun/bin`) or a file git or a shell runs (`~/.gitconfig`).
   */
  static readonly TOOL_OWNED_PATHS = [
    '$BUN_INSTALL/install/**',
    '~/.bun/install/**',
    '~/.npm/_cacache/**',
    '~/.npm/_logs/**',
    '~/.pnpm-store/**',
    '~/.local/share/pnpm/store/**',
    '~/.yarn/berry/cache/**',
    '~/.yarn/cache/**',
    '$XDG_RUNTIME_DIR/**',
    '$CLAUDE_CONFIG_DIR/projects/*/memory/**',
    '~/.claude/projects/*/memory/**',
    '/dev/null',
    '/dev/stdout',
    '/dev/stderr',
    '/dev/tty',
  ];
}
