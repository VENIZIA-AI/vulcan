import { EventActorNames } from './actor-names.ts';
import { ConstClass } from '../../common/types.ts';

/** What happened. A board reads these; add one only when a reader needs to tell it apart. */
export class EventKinds extends ConstClass {
  static readonly SESSION_START = 'session-start';
  /** No longer written (a turn that ends is not an event); read so a log written before still folds until its retention removes it. */
  static readonly SESSION_STOP = 'session-stop';
  static readonly MSG_SENT = 'msg-sent';
  static readonly MSG_RECEIVED = 'msg-received';
  static readonly NEEDS_OWNER = 'needs-owner';
  /** A subagent started: its session is busy until it stops. */
  static readonly SUBAGENT_START = 'subagent-start';
  static readonly SUBAGENT_STOP = 'subagent-stop';
  static readonly COMMIT = 'commit';
  static readonly PR = 'pr';
  /** The owner's answer to a flow, written by whoever relays it; its `status` says which. */
  static readonly DECISION = 'decision';
  /** A flow's title and the one-line reason for it, in the owner's language; the newest per flow wins. */
  static readonly FLOW = 'flow';
  /** Something was put live; a milestone of its flow, like a merge. Its summary says what. */
  static readonly DEPLOY = 'deploy';
  /** No longer written (a tool that is used is not an event); read so a log written before still folds until its retention removes it. */
  static readonly TOOL_TICK = 'tool-tick';
  /** The tokens a Claude Code session or subagent used since the last such line, as numbers and a model: never a price. */
  static readonly USAGE = 'usage';
}

/** What a `decision` line says: the owner approved, parked or rejected the flow. */
export class EventStatuses extends ConstClass {
  static readonly APPROVE = 'approve';
  static readonly PARK = 'park';
  static readonly REJECT = 'reject';
}

/** Who wrote the line: the hook installed for Claude Code, or `vulcan event add`. */
export class EventSources {
  static readonly CLAUDE_HOOK = 'claude-hook';
  static readonly CLI = 'cli';
}

/** What a shell call did that the board should know; the Bash hook writes a fixed line for each. */
export class GitActivities extends ConstClass {
  static readonly COMMIT = 'commit';
  static readonly PR_OPEN = 'pr-open';
  static readonly PR_MERGE = 'pr-merge';
}

export class EventSubcommands {
  static readonly ADD = 'add';
  static readonly TAIL = 'tail';
  static readonly STEP = 'step';
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
  /** `vulcan event step`: the step's text, set done or open. */
  static readonly DONE = '--done';
  static readonly TODO = '--todo';

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
    this.DONE,
    this.TODO,
  ]);
}

/** The names a Claude Code hook payload carries, as Claude Code 2.1.317 sends them. */
export class ClaudeHookEvents {
  static readonly SESSION_START = 'SessionStart';
  static readonly SUBAGENT_START = 'SubagentStart';
  static readonly SUBAGENT_STOP = 'SubagentStop';
  static readonly NOTIFICATION = 'Notification';
  static readonly POST_TOOL_USE = 'PostToolUse';
  /** The cross-session tool whose calls are logged as `msg-sent`. */
  static readonly SEND_MESSAGE_TOOL = 'SendMessage';
  /** The task-list tool whose list is mirrored into the steps of the flow. */
  static readonly TODO_TOOL = 'TodoWrite';
  /** The shell tool: only its class of command (a commit, a pull request opened or merged) is logged, never the command. */
  static readonly BASH_TOOL = 'Bash';
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
  static readonly MANIFEST_FILE = '.agents/local/vulcan.manifest.json';
  /** The per-checkout file; the same path as `AgentConstants.LOCAL_FILE`, kept here because the event hook loads no other module (a test holds them equal). */
  static readonly LOCAL_FILE = '.agents/local/profile.json';
  /** The file of the releases before 0.5.0; read when the profile has no such key, until `vulcan sync` has moved its keys. */
  static readonly LEGACY_LOCAL_FILE = '.agents/vulcan.local.json';
  /** A day file of the log: `<local day>.jsonl`; the capture is the day. */
  static readonly DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
  static readonly FILE_SUFFIX = '.jsonl';
  static readonly SUMMARY_MAX = 200;
  /** A flow's context is a few sentences, not a summary line. */
  static readonly CONTEXT_MAX = 600;
  /** What a sent message is called when its sender gave no label: the text of a message is never used. */
  static readonly MESSAGE_SENT_LABEL = 'message sent';
  /** The fixed summaries of the lines the Bash hook writes, and what the Stop hook looks for. */
  static readonly COMMIT_LABEL = 'commit';
  static readonly PR_OPEN_LABEL = 'pull request opened';
  static readonly PR_MERGE_LABEL = 'pull request merge';
  /** The fixed summary of a `usage` line. */
  static readonly USAGE_LABEL = 'tokens';
  /** What the usage meter reads of a transcript it meets for the first time: a longer one is marked at its end and counts nothing. */
  static readonly USAGE_FIRST_READ_MAX = 128 * 1024 * 1024;
  /** The model named on a `usage` line that only moves the mark (a transcript too long to read the first time). */
  static readonly USAGE_NO_MODEL = 'none';
  static readonly REF_MAX = 120;
  /** A flow line's lists: how many items, and how long one is. */
  static readonly ITEM_COUNT_MAX = 30;
  /** How far back the task-list mirror looks for the flow's last line: it reads the log on every `TodoWrite`. */
  static readonly MIRROR_DAYS = 3;
  /** How many of a session's flows are checked for being over before the search gives up. */
  static readonly LAST_OPENED_CHECKS = 5;
  static readonly ITEM_TEXT_MAX = 200;
  static readonly APP_COUNT_MAX = 12;
  static readonly APP_TEXT_MAX = 40;
  /** A due date is a day: `2026-11-08`. */
  static readonly DUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  static readonly MODEL_MAX = 80;
  static readonly ACTOR_MAX = 80;
  static readonly REDACTED = '[redacted]';
  /** How much of a long text the redaction reads for a result of `max` characters: `max * factor`, at least `min`. */
  static readonly REDACT_SCAN = { factor: 4, min: 1024 };
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
  static readonly UNKNOWN_ACTOR = EventActorNames.UNKNOWN;
  static readonly UNNAMED_PREFIX = EventActorNames.UNNAMED_PREFIX;
  /** The `nameSource` values of a name Claude Code made up (from the folder, a counter or a clash), not a person's. */
  static readonly MADE_UP_NAME_SOURCES = new Set(['derived', 'auto', 'collision']);
  static readonly ACTOR_ENV = 'VULCAN_ACTOR';
  static readonly SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
  static readonly CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
  static readonly DAY_MS = 24 * 60 * 60 * 1000;
  /** A flow with open steps and no line of work for this long gets a reminder from the Stop hook, once per period per session. */
  static readonly STALE_FLOW_MS = 2 * 60 * 60 * 1000;
  /** The folder of the events folder that holds, per session, when it was last reminded of a stale flow. */
  static readonly STALE_REMINDER_DIR = '.stale-reminders';
  /** A reminder file this old (by its modified time) is removed the next time one is written. */
  static readonly STALE_REMINDER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
}

/**
 * Shapes of a secret that must never reach a log line. Best effort: a summary is a label, not a document. Each pattern
 * reads a long line in time in proportion to its length (doctor runs them over whole files); a test times each one.
 * Group 1, in a pattern that has one, is the name, flag or command before the secret: it is kept and the rest replaced.
 * A value that starts with `$`, `<`, `%` or `{`, quoted or not, is a variable or a placeholder, not a secret.
 */
export class EventSecrets {
  static readonly PRIVATE_KEY = /-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----.*/g;
  /** The known token prefixes and shapes, and the credentials a command line, a header or a query carries. */
  static readonly TOKENS: RegExp[] = [
    /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{16,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
    /\bnpm_[A-Za-z0-9]{16,}/g,
    /\bsk-[A-Za-z0-9_-]{16,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bAIza[0-9A-Za-z_-]{35}/g,
    /\bglpat-[A-Za-z0-9_-]{16,}/g,
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
    /\bhf_[A-Za-z0-9]{30,}/g,
    /\bdop_v1_[0-9a-f]{64}\b/g,
    /\bshpat_[0-9a-fA-F]{32}\b/g,
    /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    // A Basic credential is base64 of user:password: it has a digit, a + or a /, a capital inside it, or ends in =; a plain word after "Basic" has none of these.
    /\bBasic\s+(?:(?=[A-Za-z0-9+/]*(?:[0-9+/]|[a-z][A-Z]))[A-Za-z0-9+/]{8,}={0,2}|[A-Za-z0-9+/]{8,}={1,2})/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    // A Bearer credential has a digit, a + / or =, a dot between two characters, or a capital inside it; a plain word of letters ("Bearer authentication", "Bearer authentication.") has none of these. No `i` flag: it would make every pair of letters an inner capital.
    /\b(?:Bearer|bearer|BEARER)\s+(?=[A-Za-z0-9._~+/=-]*(?:[0-9+/=]|[a-z][A-Z]|[A-Za-z0-9]\.[A-Za-z0-9]))[A-Za-z0-9._~+/=-]{8,}/g,
    // Any other scheme of an Authorization header, with its value: the value has a digit, a + / or =, or a capital inside it, so a placeholder or a word does not count. Bearer and Basic are the two patterns above.
    /(\b(?:[Aa]uthorization|AUTHORIZATION)["']?\s{0,8}:\s{0,8})(?![Bb]earer\s|BEARER\s|[Bb]asic\s|BASIC\s)(?:[A-Za-z][A-Za-z0-9_-]{0,31}\s{1,8})?(?!["']?[$<%{])(?=[^\s]{0,511}(?:[0-9+/=]|[a-z][A-Z]))[^\s]{8,512}/g,
    // The cookies of a Cookie or Set-Cookie header, each `name=value` and the attributes after them.
    /(\b(?:[Ss]et-)?(?:[Cc]ookie|COOKIE):\s{0,8})(?!["']?[$<%{])[^\s;=]{1,64}=[^\s;]{1,512}(?:;\s{0,8}[^\s;=]{1,64}(?:=[^\s;]{0,512})?){0,16}/g,
    // The password in the user and password pair given to curl's user flag, in the same command.
    /(\bcurl\s(?:[^|;&]{0,256}?\s)?(?:-u|--user)(?:\s{1,8}|=)?(?!-)["']?[^\s:]{1,128}:)(?![\s-])(?!["']?[$<%{])[^\s]{1,256}/g,
    // The value of `-p` joined to it (`-p` with a space asks for the password) for the MySQL and MariaDB clients.
    /(\b(?:mysql|mysqldump|mysqladmin|mariadb|mariadb-dump)\s(?:[^|;&]{0,256}?\s)?-p)(?![\s-])(?!["']?[$<%{])[^\s]{1,256}/g,
    // The value of `-p`, joined or after a space, for sshpass before the command it wraps, and for a docker, podman or az login.
    /(\bsshpass\s{1,8}(?:-[A-Za-z]\S{0,64}\s{1,8}){0,4}-p(?:\s{1,8})?)(?![\s-])(?!["']?[$<%{])[^\s]{1,256}/g,
    /(\b(?:docker|podman|az)\s{1,8}login\s(?:[^|;&]{0,256}?\s)?-p(?:\s{1,8}|=)?)(?![\s-])(?!["']?[$<%{])[^\s]{1,256}/g,
    // The password flag of redis-cli (`-a`) and sqlcmd (`-P`), after a space.
    /(\bredis-cli\s(?:[^|;&]{0,256}?\s)?-a\s{1,8})(?!-)(?!["']?[$<%{])[^\s]{1,256}/g,
    /(\bsqlcmd\s(?:[^|;&]{0,256}?\s)?-P\s{1,8})(?!-)(?!["']?[$<%{])[^\s]{1,256}/g,
    // The secret key or session token that `aws configure set` writes.
    /(\baws\s{1,8}configure\s{1,8}set\s{1,8}(?:[A-Za-z0-9_-]{1,64}\.)?(?:aws_secret_access_key|aws_session_token)\s{1,8})(?!-)(?!["']?[$<%{])[^\s]{1,256}/g,
    // The value after a flag that names a secret, given with a space; `--name=value` is the assignment.
    /((?:^|\s)--(?:password|passwd|http-password|ftp-password|proxy-password|token|secret|api-key|apikey|auth-token|access-token)\s{1,8})(?!-)(?!["']?[$<%{])[^\s]{1,256}/g,
    // `--key` names many things that are not secret: its value counts when it has a digit, a + or =, or a capital inside it, and is not a path or a file name.
    /((?:^|\s)--key\s{1,8})(?!["']?[$<%{]|[~./-])(?![^\s]{0,251}\.[A-Za-z]{1,4}(?:\s|$))(?=[^\s]{0,255}(?:[0-9+=]|[a-z][A-Z]))[^\s]{8,256}/g,
    // The path of a Slack incoming webhook: the workspace, the channel and the secret.
    /(\bhooks\.slack\.com\/services\/)T[A-Z0-9]{6,32}\/B[A-Z0-9]{6,32}\/[A-Za-z0-9]{16,64}/g,
    // A 40-character AWS secret access key assigned to a name that holds `aws` or `secret`.
    /((?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,64}(?:aws|secret)[A-Za-z0-9_.-]{0,64}["']?\s{0,8}[:=]\s{0,8}["']?)[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/gi,
    // The signature of a shared access URL, `sig=` in its query.
    /([?&]sig=)[A-Za-z0-9%+/=_-]{16,256}/g,
  ];
  /** Long runs that are secrets in a log line but hashes in a lockfile. */
  static readonly HIGH_ENTROPY: RegExp[] = [
    /\b[0-9a-fA-F]{64,}\b/g,
    /(?<![A-Za-z0-9+_])(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[a-z])(?=[A-Za-z0-9+]*[A-Z])[A-Za-z0-9+]{40,}={0,2}/g,
  ];
  /**
   * Credentials inside a URL, up to the `@` before the host: `user:password` (the user may be empty, the password runs to
   * the last `@` before the host; a port and a path are not a password), and a DSN key `<32 hex>`.
   */
  static readonly URL_CREDENTIALS: RegExp[] = [
    /(\/\/)[^\s/@:]{0,128}:(?!\d{1,5}(?:[/?#\s]|$))[^\s]{1,256}?(?=@[^\s/@?#]{1,253}(?:[/:?#\s]|$))/g,
    /(\/\/)[0-9a-fA-F]{32}(?::[0-9a-fA-F]{32})?(?=@)/g,
  ];
  /** Everything `EventText.redact` replaces, in the order it replaces it. */
  static readonly PATTERNS: RegExp[] = [
    EventSecrets.PRIVATE_KEY,
    ...EventSecrets.TOKENS,
    ...EventSecrets.HIGH_ENTROPY,
    ...EventSecrets.URL_CREDENTIALS,
  ];
  /**
   * `name=value`, `name: value` and `"name": "value"` where the name says it is a secret, or has `pw`, `pass` or
   * `passphrase` as a whole part (`DB_PASS`, `pw_x`). A switch value (`true`, `off`, `1`) is not a secret.
   */
  static readonly ASSIGNMENT =
    /["']?(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]{0,64}(?:key|token|secret|password|passwd|pwd|credential)[A-Za-z0-9_.-]{0,64}|(?:[A-Za-z0-9_.-]{0,64}[_.-])?(?:pw|pass|passphrase)(?:[_.-][A-Za-z0-9_.-]{0,64})?)["']?\s{0,8}[:=]\s{0,8}(?!["']?(?:0|1|true|false|yes|no|on|off)(?![A-Za-z0-9_]))("[^"]{0,256}"|'[^']{0,256}'|\S{1,256})/gi;
  /** "the password is hunter2". */
  static readonly SPOKEN =
    /\b((?:password|passwd|passphrase|secret|token|api[ _-]?key)s?)\s{1,8}(?:is|are|was|were)\s{1,8}("[^"]{0,256}"|'[^']{0,256}'|\S{1,256})/gi;
}
