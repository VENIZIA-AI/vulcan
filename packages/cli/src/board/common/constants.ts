/** The states a flow is in, in the order the board lists them. */
export class BoardStates {
  static readonly YOU = 'you';
  static readonly BLOCKED = 'blocked';
  static readonly RUNNING = 'running';
  static readonly PARKED = 'parked';
  static readonly DONE = 'done';

  static readonly ORDER = [this.YOU, this.BLOCKED, this.RUNNING, this.PARKED, this.DONE];
}

/** What happened, in the words of the board page. The event log's own kinds are mapped to these. */
export class BoardKinds {
  static readonly REQUEST = 'request';
  static readonly DECISION = 'decision';
  static readonly ASSIGN = 'assign';
  static readonly NOTE = 'note';
  static readonly DESIGN = 'design';
  static readonly COMMIT = 'commit';
  static readonly PR = 'pr';
  static readonly CI = 'ci';
  static readonly REVIEW = 'review';
  static readonly FIX = 'fix';
  static readonly MERGE = 'merge';
  static readonly RELEASE = 'release';
  static readonly HANDOFF = 'handoff';
  static readonly MSG = 'msg';
}

/** The stages of a flow, in the order of the page's strip. */
export class BoardStages {
  static readonly REQUEST = 0;
  static readonly APPROVAL = 1;
  static readonly DESIGN = 2;
  static readonly CODE = 3;
  static readonly PR_AND_CI = 4;
  static readonly REVIEW = 5;
  static readonly MERGE = 6;
  static readonly RELEASE = 7;
  static readonly HANDOFF = 8;
}

/** How an event came out; `pass` and `fail` are for CI and reviews. */
export class BoardStatuses {
  static readonly PASS = 'pass';
  static readonly FAIL = 'fail';
  static readonly DONE = 'done';
  static readonly BLOCKED = 'blocked';
  static readonly PARKED = 'parked';
  static readonly DROPPED = 'dropped';
  static readonly CLOSED = 'closed';
  static readonly OPEN = 'open';
}

export class BoardFlags {
  static readonly OUT = '--out';
  static readonly OPEN = '--open';
  static readonly SINCE = '--since';
  static readonly DIR = '--dir';
  static readonly REPO = '--repo';
  /** Leave GitHub out, for a project that is not on it. */
  static readonly NO_GITHUB = '--no-github';
}

/** The faces the page can draw for an agent. `bun` is the default; the others are chosen by name in `board.agents`. */
export class BoardShapes {
  static readonly BUN = 'bun';
  static readonly FLAME = 'flame';
  static readonly EMBER = 'ember';
  static readonly ROCK = 'rock';
  static readonly BANANA = 'banana';

  static readonly SCHEME_SET = new Set<string>([
    this.BUN,
    this.FLAME,
    this.EMBER,
    this.ROCK,
    this.BANANA,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class BoardSources {
  static readonly GITHUB = 'github';
}

export class BoardConstants {
  /** Who an ask waits on when neither `board.owner` nor `git config user.name` says. */
  static readonly DEFAULT_OWNER = 'Owner';
  static readonly LOGO_MAX_BYTES = 100 * 1024;
  static readonly MANIFEST_FILE = '.agents/vulcan.manifest.json';
  static readonly CI_ACTOR = 'CI';
  static readonly UNSORTED = 'Unsorted';
  static readonly DEFAULT_OUT = '.agents/local/reports/board.html';
  static readonly DEFAULT_DAYS = 7;
  static readonly DAY_MS = 24 * 60 * 60 * 1000;
  static readonly TEMPLATE = 'templates/board.html';
  static readonly DATA_MARKER = '<!--BOARD_DATA-->';
  static readonly GH_TIMEOUT_MS = 15_000;
  static readonly GH_LIMIT = 30;
  /** Kinds that mean someone did work on the flow, for the holder. */
  static readonly WORK_KINDS = [
    BoardKinds.ASSIGN,
    BoardKinds.DESIGN,
    BoardKinds.COMMIT,
    BoardKinds.PR,
    BoardKinds.FIX,
    BoardKinds.NOTE,
  ];
  /** A later line of one of these kinds answers an ask when no decision does. */
  static readonly PROGRESS_KINDS = [
    BoardKinds.COMMIT,
    BoardKinds.PR,
    BoardKinds.FIX,
    BoardKinds.MERGE,
    BoardKinds.RELEASE,
    BoardKinds.HANDOFF,
  ];
}
