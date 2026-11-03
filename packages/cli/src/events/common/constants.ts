/** What happened. A board reads these; add one only when a reader needs to tell it apart. */
export class EventKinds {
  static readonly SESSION_START = 'session-start';
  static readonly SESSION_STOP = 'session-stop';
  static readonly MSG_SENT = 'msg-sent';
  static readonly MSG_RECEIVED = 'msg-received';
  static readonly NEEDS_OWNER = 'needs-owner';
  static readonly SUBAGENT_STOP = 'subagent-stop';
  static readonly COMMIT = 'commit';
  static readonly PR = 'pr';
  /** The owner's answer to a flow, written by whoever relays it; its `status` says which. */
  static readonly DECISION = 'decision';

  static readonly SCHEME_SET = new Set<string>([
    this.SESSION_START,
    this.SESSION_STOP,
    this.MSG_SENT,
    this.MSG_RECEIVED,
    this.NEEDS_OWNER,
    this.SUBAGENT_STOP,
    this.COMMIT,
    this.PR,
    this.DECISION,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** What a `decision` line says: the owner approved, parked or rejected the flow. */
export class EventStatuses {
  static readonly APPROVE = 'approve';
  static readonly PARK = 'park';
  static readonly REJECT = 'reject';

  static readonly SCHEME_SET = new Set<string>([this.APPROVE, this.PARK, this.REJECT]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** Who wrote the line: the hook installed for Claude Code, or `vulcan event add`. */
export class EventSources {
  static readonly CLAUDE_HOOK = 'claude-hook';
  static readonly CLI = 'cli';
}

export class EventSubcommands {
  static readonly ADD = 'add';
  static readonly TAIL = 'tail';
}

export class EventFlags {
  static readonly KIND = '--kind';
  static readonly SUMMARY = '--summary';
  static readonly FLOW = '--flow';
  static readonly REF = '--ref';
  static readonly STATUS = '--status';
  static readonly ACTOR = '--actor';
  static readonly DIR = '--dir';
  static readonly SINCE = '--since';
  static readonly JSON = '--json';
}

/** The names a Claude Code hook payload carries, as Claude Code 2.1.317 sends them. */
export class ClaudeHookEvents {
  static readonly SESSION_START = 'SessionStart';
  static readonly STOP = 'Stop';
  static readonly SUBAGENT_STOP = 'SubagentStop';
  static readonly NOTIFICATION = 'Notification';
  static readonly POST_TOOL_USE = 'PostToolUse';
  /** The cross-session tool whose calls are logged as `msg-sent`. */
  static readonly SEND_MESSAGE_TOOL = 'SendMessage';
  /** The notification types that mean an agent waits for a person; `auth_success` does not. */
  static readonly OWNER_NOTIFICATIONS = new Set<string>([
    'permission_prompt',
    'idle_prompt',
    'elicitation_dialog',
  ]);
}

export class EventConstants {
  /** Relative to the project root; the default place of the log. */
  static readonly DEFAULT_DIRECTORY = '.agents/local/events';
  static readonly MANIFEST_FILE = '.agents/vulcan.manifest.json';
  static readonly FILE_SUFFIX = '.jsonl';
  static readonly SUMMARY_MAX = 200;
  /** What a sent message is called when its sender gave no label: the text of a message is never used. */
  static readonly MESSAGE_SENT_LABEL = 'message sent';
  static readonly REF_MAX = 120;
  static readonly ACTOR_MAX = 80;
  static readonly REDACTED = '[redacted]';
  static readonly FLOW_PATTERN = /\bF-\d+\b/;
  static readonly FLOW_EXACT = /^F-\d+$/;
  /** `Flow: F-n` in a message's first line. */
  static readonly FLOW_LINE = /\bFlow:\s*(F-\d+)\b/;
  /** Where the log goes for a hook that has no better answer: the name of an actor with no session name. */
  static readonly UNKNOWN_ACTOR = 'unknown';
  static readonly ACTOR_ENV = 'VULCAN_ACTOR';
  static readonly SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
  static readonly CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
  static readonly DAY_MS = 24 * 60 * 60 * 1000;
}

/** Shapes of a secret that must never reach a log line. Best effort: a summary is a label, not a document. */
export class EventSecrets {
  static readonly PATTERNS: RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g,
    /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{16,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
    /\bnpm_[A-Za-z0-9]{16,}/g,
    /\bsk-[A-Za-z0-9_-]{16,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bAIza[0-9A-Za-z_-]{35}/g,
    /\bglpat-[A-Za-z0-9_-]{16,}/g,
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    // A Basic credential is base64 of user:password: it has a digit, a + or a /, a capital inside it, or ends in =; a plain word after "Basic" has none of these.
    /\bBasic\s+(?:(?=[A-Za-z0-9+/]*(?:[0-9+/]|[a-z][A-Z]))[A-Za-z0-9+/]{8,}={0,2}|[A-Za-z0-9+/]{8,}={1,2})/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /\b[0-9a-fA-F]{64,}\b/g,
    /\b(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[a-z])(?=[A-Za-z0-9+]*[A-Z])[A-Za-z0-9+]{40,}={0,2}/g,
  ];
  /** `user:password@host` inside a URL. */
  static readonly URL_USERINFO = /(\/\/)[^\s/@:]+:[^\s/@]+@/g;
  /** `name=value`, `name: value` and `"name": "value"` where the name says it is a secret. */
  static readonly ASSIGNMENT =
    /["']?\b([A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|pwd|credential)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi;
  /** "the password is hunter2". */
  static readonly SPOKEN =
    /\b((?:password|passwd|passphrase|secret|token|api[ _-]?key)s?)\s+(?:is|are|was|were)\s+("[^"]*"|'[^']*'|\S+)/gi;
}
