export class SignalConstants {
  /** The turn's notes: one JSON line per call, appended, so parallel hook processes never overwrite each other. */
  static readonly LOG_FILE = 'cache/signals.jsonl';
  /** The log is rewritten smaller at a new turn once it grows past this. */
  static readonly COMPACT_BYTES = 32 * 1024;
  /** Only the end of an oversized log is read. */
  static readonly READ_TAIL_BYTES = 256 * 1024;
  static readonly MAX_EVENTS = 30;
  /** The same advisory is not repeated inside this window. */
  static readonly DEBOUNCE_MS = 5 * 60 * 1000;
  static readonly SAME_CALL_LIMIT = 3;
  /** Identical calls further apart than this are polling, not a loop. */
  static readonly POLL_WINDOW_MS = 60 * 1000;
  static readonly ALTERNATION_LENGTH = 6;
  static readonly FAILURE_LIMIT = 3;
  static readonly FAILURE_WINDOW = 6;
  static readonly EVENT_KEY_LENGTH = 12;
  static readonly GATE_KEY_LENGTH = 80;
}

export class EntryKinds {
  static readonly TURN = 'turn';
  static readonly CALL = 'call';
  static readonly NOTE = 'note';
}

export class WatchedKinds {
  static readonly SKILL = 'skill';
  static readonly RULES = 'rules';
}

/** What a reply claimed that the turn's tool calls do not back. Both are logged, never blocking. */
export class ClaimClasses {
  static readonly CONTRADICTED_COMPLETION = 'contradicted-completion';
  static readonly PUBLIC_CLAIM_NO_PROBE = 'public-claim-no-probe';
  static readonly SCHEME_SET = new Set<string>([
    this.CONTRADICTED_COMPLETION,
    this.PUBLIC_CLAIM_NO_PROBE,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** Phrases that say something is in public state, and that the work is complete and checked; English by default. */
export class ClaimWords {
  static readonly PUBLIC = [
    'published',
    'released',
    'deployed',
    'is live',
    'went live',
    'now live',
  ];
  static readonly DONE = [
    'all tests pass',
    'tests pass',
    'tests are passing',
    'everything passes',
    'all checks pass',
    'all green',
    'build passes',
    'lint is clean',
    'gates pass',
  ];
  /** A sentence with one of these is not a claim: it denies, asks, or speaks of what is not yet so. */
  static readonly NEGATIONS = [
    'not',
    'no',
    'nothing',
    'never',
    'yet',
    'whether',
    'if',
    'unless',
    'until',
    'when',
    'once',
    'will',
    'would',
    'should',
    'could',
    'might',
    'unpublished',
    'unreleased',
    "n't",
  ];
}
