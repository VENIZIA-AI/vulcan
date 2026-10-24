/** What the guard asks Claude Code to do with a flagged command: ask the human, or refuse outright. */
export class GuardDecisions {
  static readonly ASK = 'ask';
  static readonly DENY = 'deny';
  static readonly SCHEME_SET = new Set<string>([this.ASK, this.DENY]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class HookConstants {
  /** `ask` until the transcript shows the guard does not over-fire; a false positive costs one keystroke. */
  static readonly GUARD_DECISION = GuardDecisions.ASK;
  static readonly PRE_TOOL_USE = 'PreToolUse';
  static readonly SUBAGENT_START = 'SubagentStart';
  /** `git` and `gh` queries the guards make; a slow one is dropped and the command passes. */
  static readonly QUERY_TIMEOUT_MS = 5000;
  /** Branches no agent deletes or force-pushes (V-W-06). */
  static readonly PROTECTED_BRANCHES = new Set(['develop', 'main']);
  /** Set to `off` to switch the guards off for a session; the hooks then pass every call. */
  static readonly KILL_SWITCH_ENV = 'VULCAN_GUARDS';
  static readonly KILL_SWITCH_OFF = 'off';
  /** Tool-owned stores an agent may write into: package manager caches, the runtime dir for locks, git's config, the agent tool's memory. */
  static readonly TOOL_OWNED_PATHS = [
    '$BUN_INSTALL/**',
    '~/.bun/**',
    '~/.npm/**',
    '~/.pnpm-store/**',
    '~/.local/share/pnpm/**',
    '~/.yarn/**',
    '$XDG_RUNTIME_DIR/**',
    '~/.gitconfig',
    '~/.config/git/**',
    '$CLAUDE_CONFIG_DIR/projects/*/memory/**',
    '~/.claude/projects/*/memory/**',
    '/dev/null',
    '/dev/stdout',
    '/dev/stderr',
    '/dev/tty',
  ];
}
