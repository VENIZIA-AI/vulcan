/** What the guard asks Claude Code to do with a flagged command: ask the human, or refuse outright. */
export class GuardDecisions {
  static readonly ASK = 'ask';
  static readonly DENY = 'deny';
  static readonly SCHEME_SET = new Set<string>([this.ASK, this.DENY]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** What the package guard says about a hand-made package: refuse where a `vulcan add` command exists, else warn. */
export class PackageVerdictKinds {
  static readonly DENY = GuardDecisions.DENY;
  static readonly WARN = 'warn';

  static readonly SCHEME_SET = new Set<string>([this.DENY, this.WARN]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
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
  /** Branches no agent deletes or force-pushes (V-W-06). */
  static readonly PROTECTED_BRANCHES = new Set(['develop', 'main']);
  /** Set to `off` to switch the guards off for a session; the hooks then pass every call. */
  static readonly KILL_SWITCH_ENV = 'VULCAN_GUARDS';
  static readonly KILL_SWITCH_OFF = 'off';
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
