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
  /** A flow's title and the one-line reason for it, in the owner's language; the newest per flow wins. */
  static readonly FLOW = 'flow';
  /** Something was put live; a milestone of its flow, like a merge. Its summary says what. */
  static readonly DEPLOY = 'deploy';
  /** An agent used a tool, at most once in `EventConstants.TICK_SECONDS` per session: the board reads it as working. */
  static readonly TOOL_TICK = 'tool-tick';

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
    this.FLOW,
    this.DEPLOY,
    this.TOOL_TICK,
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
  /** The lists of a flow line, each given again in full on every line: the last line wins as a whole. */
  static readonly STEP = '--step';
  static readonly STEP_DONE = '--step-done';
  static readonly CHECK = '--check';
  static readonly CHECK_DONE = '--check-done';
  static readonly APP = '--app';
  static readonly DUE = '--due';
  static readonly KIND = '--kind';
  static readonly SUMMARY = '--summary';
  static readonly FLOW = '--flow';
  static readonly REF = '--ref';
  static readonly STATUS = '--status';
  static readonly TITLE = '--title';
  static readonly WHY = '--why';
  static readonly CONTEXT = '--context';
  static readonly NEXT = '--next';
  static readonly ACTOR = '--actor';
  static readonly DIR = '--dir';
  static readonly SINCE = '--since';
  static readonly JSON = '--json';

  /** Every flag the command knows: a list value that is one of them is a flag with its value missing. */
  static readonly KNOWN = new Set<string>([
    this.STEP,
    this.STEP_DONE,
    this.CHECK,
    this.CHECK_DONE,
    this.APP,
    this.DUE,
    this.KIND,
    this.SUMMARY,
    this.FLOW,
    this.REF,
    this.STATUS,
    this.TITLE,
    this.WHY,
    this.CONTEXT,
    this.NEXT,
    this.ACTOR,
    this.DIR,
    this.SINCE,
    this.JSON,
  ]);
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

/** The size units of `events.maxSize`: a number and one of these, such as `50MB`. */
export class EventSizeUnits {
  static readonly BYTES: Record<string, number> = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  static readonly PATTERN = /^(\d+(?:\.\d+)?)\s?(KB|MB|GB)$/i;
}

export class EventConstants {
  /** What the log keeps when `events.log` is on and the project sets no limit. */
  static readonly DEFAULT_MAX_SIZE = '50MB';
  static readonly DEFAULT_MAX_FILES = 30;
  static readonly DEFAULT_MAX_AGE_DAYS = 30;
  /** Relative to the project root; the default place of the log. */
  static readonly DEFAULT_DIRECTORY = '.agents/local/events';
  static readonly MANIFEST_FILE = '.agents/vulcan.manifest.json';
  /** A day file of the log: `<local day>.jsonl`; the capture is the day. */
  static readonly DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
  static readonly FILE_SUFFIX = '.jsonl';
  static readonly SUMMARY_MAX = 200;
  /** A flow's context is a few sentences, not a summary line. */
  static readonly CONTEXT_MAX = 600;
  /** What a sent message is called when its sender gave no label: the text of a message is never used. */
  static readonly MESSAGE_SENT_LABEL = 'message sent';
  /** The summary of a tool tick: it says that a tool was used, and nothing of which. */
  static readonly TOOL_TICK_LABEL = 'using a tool';
  /** A session writes at most one tool tick in each window of this many seconds. */
  static readonly TICK_SECONDS = 30;
  /**
   * The folder, from the project root, that holds one empty stamp per session and window, `<session>.<window>`; a tick
   * removes the stamps of earlier windows. Spelt out because the hook imports no other module of the package (a test holds it
   * inside `ProjectLayout.LOCAL_DIRECTORY/tmp`).
   */
  static readonly TICK_FOLDER = '.agents/local/tmp/event-ticks';
  static readonly REF_MAX = 120;
  /** A flow line's lists: how many items, and how long one is. */
  static readonly ITEM_COUNT_MAX = 30;
  static readonly ITEM_TEXT_MAX = 200;
  static readonly APP_COUNT_MAX = 12;
  static readonly APP_TEXT_MAX = 40;
  /** A due date is a day: `2026-11-08`. */
  static readonly DUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  static readonly MODEL_MAX = 80;
  static readonly ACTOR_MAX = 80;
  static readonly REDACTED = '[redacted]';
  /** A flow is named `VULZ-<key>-<number>`; the older `F-<number>` is still read and shows as the new form. */
  static readonly FLOW_PREFIX = 'VULZ';
  static readonly FLOW_ID = 'VULZ-[A-Z0-9]{2,8}-\\d+|F-\\d+';
  static readonly FLOW_PATTERN = new RegExp(`\\b(?:${EventConstants.FLOW_ID})\\b`);
  static readonly FLOW_EXACT = new RegExp(`^(?:${EventConstants.FLOW_ID})$`);
  /** `Flow: <id>` in a message's first line. */
  static readonly FLOW_LINE = new RegExp(`\\bFlow:\\s*(${EventConstants.FLOW_ID})\\b`);
  /** An older flow id, `F-<number>`. */
  static readonly FLOW_LEGACY = /^F-\d+$/;
  /** The folder of claims beside the day files: one file per flow number given, so a number is never given twice. */
  static readonly FLOW_CLAIM_DIR = '.flow-ids';
  /** How many recent flows a refusal lists. */
  static readonly FLOW_RECENT_COUNT = 5;
  /** Where the log goes for a hook that has no better answer: the name of an actor with no session name. */
  static readonly UNKNOWN_ACTOR = 'unknown';
  static readonly ACTOR_ENV = 'VULCAN_ACTOR';
  static readonly SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
  static readonly CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
  static readonly DAY_MS = 24 * 60 * 60 * 1000;
}

/** Shapes of a secret that must never reach a log line. Best effort: a summary is a label, not a document. */
export class EventSecrets {
  static readonly PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g;
  /** The known token prefixes and shapes. */
  static readonly TOKENS: RegExp[] = [
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
  ];
  /** Long runs that are secrets in a log line but hashes in a lockfile. */
  static readonly HIGH_ENTROPY: RegExp[] = [
    /\b[0-9a-fA-F]{64,}\b/g,
    /\b(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[a-z])(?=[A-Za-z0-9+]*[A-Z])[A-Za-z0-9+]{40,}={0,2}/g,
  ];
  /** Everything `EventText.redact` replaces, in the order it replaces it. */
  static readonly PATTERNS: RegExp[] = [
    EventSecrets.PRIVATE_KEY,
    ...EventSecrets.TOKENS,
    ...EventSecrets.HIGH_ENTROPY,
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
