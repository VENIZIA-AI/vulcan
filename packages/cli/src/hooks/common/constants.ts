/** What the guard asks Claude Code to do with a flagged command: ask the human, or refuse outright. */
export class GuardDecisions {
  static readonly ASK = 'ask';
  static readonly DENY = 'deny';
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
  /**
   * A blanket stage (`git add -A`, `git commit -a`) asks past this many changed paths. A formatter run once put 152
   * unintended files into one commit; on this repository's develop the median commit touches 7 files and 2.2% touch more than 50.
   */
  static readonly BLANKET_STAGE_PATHS = 50;
  /** The environment variable that makes every guard refuse what it would ask about; the launch environment sets it, the project cannot loosen it. */
  static readonly ENV_ASKS = 'VULCAN_GUARD_ASKS';
  /** The environment variable that makes guard-outside refuse a write outside the project; as `ENV_ASKS`. */
  static readonly ENV_OUTSIDE = 'VULCAN_GUARD_OUTSIDE';
  /** What an answer says when the project (`guard.asks: 'deny'`) holds every ask. */
  static readonly HELD_ASK =
    'This project denies every call that would need a human to confirm it (guard.asks: deny). Nothing was run: hand this to the owner.';
  /** What an answer says when the launch environment (`VULCAN_GUARD_ASKS=deny`) holds every ask. */
  static readonly HELD_ASK_ENV =
    'This session denies every call that would need a human to confirm it (VULCAN_GUARD_ASKS=deny). Nothing was run: hand this to the owner.';
  /** What an answer says when the manifest exists and cannot be read: the hooks cannot tell what the project asked for, so an ask is a deny. */
  static readonly MANIFEST_UNREADABLE =
    'The manifest .agents/vulcan.manifest.json exists but cannot be read, so every call that would need a human to confirm it is denied. Nothing was run: the owner repairs the file or runs bun node_modules/.bin/vulcan sync.';
  /**
   * The files the guards read their policy from (the manifest, the config, Claude Code's project and launch settings, the installed package):
   * an agent that can write one can switch a guard off, so guard-outside denies it; the owner changes them by hand or through `vulcan sync`.
   */
  static readonly PROTECTED_FILES = [
    '.agents/vulcan.manifest.json',
    '.configs/vulcan.config.*',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.agents/local/claude.launch.settings.json',
    '.codex/hooks.json',
    '.agents/hooks.json',
    '.omp/hooks/pre/vulcan-guards.ts',
    '.pi/extensions/vulcan-guards.ts',
    'node_modules/@venizia/vulcan',
    'node_modules/@venizia/vulcan/**',
    // The hooks the guards run: the bundle `vulcan sync` copies in, so no package folder decides what a hook runs.
    '.agents/local/hooks',
    '.agents/local/hooks/**',
    // Bun's own copy of the package, which the link above points to, and the bin the owner runs.
    'node_modules/.bun/@venizia+vulcan@*',
    'node_modules/.bun/@venizia+vulcan@*/**',
    'node_modules/.bin/vulcan',
  ];
  /** Where `vulcan sync` copies the hook bundle, from the project root: the files every hook command runs. */
  static readonly BUNDLE_DIRECTORY = '.agents/local/hooks';
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
