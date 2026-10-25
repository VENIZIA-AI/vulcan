import type { TConstValue } from '../common/index.ts';

/** Which side of a before/after page a row is on: what was added, what was removed. */
export class ChangeKinds {
  static readonly ADDED = 'added';
  static readonly REMOVED = 'removed';

  static readonly SCHEME_SET = new Set<string>([this.ADDED, this.REMOVED]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export type TChangeKind = TConstValue<typeof ChangeKinds>;

export class StatusStates {
  static readonly OK = 'ok';
  static readonly WARN = 'warn';
  static readonly BLOCKED = 'blocked';
  static readonly INFO = 'info';
  static readonly SCHEME_SET = new Set<string>([this.OK, this.WARN, this.BLOCKED, this.INFO]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** How an edge reads: the main path, a branch, a return, a fan-out or a failure. Never by colour alone. */
export class EdgeVariants {
  static readonly MAIN = 'main';
  static readonly BRANCH = 'branch';
  static readonly RETURN = 'return';
  static readonly FANOUT = 'fanout';
  static readonly ERROR = 'error';
  static readonly SCHEME_SET = new Set<string>([
    this.MAIN,
    this.BRANCH,
    this.RETURN,
    this.FANOUT,
    this.ERROR,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class NodeKinds {
  static readonly STEP = 'step';
  static readonly SERVICE = 'service';
  static readonly STORE = 'store';
  static readonly ACTOR = 'actor';
  static readonly EXTERNAL = 'external';
  static readonly SCHEME_SET = new Set<string>([
    this.STEP,
    this.SERVICE,
    this.STORE,
    this.ACTOR,
    this.EXTERNAL,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** What a claim in the evidence table rests on. An analogy is never shown as a fact. */
export class EvidenceLabels {
  static readonly VERIFIED = 'verified';
  static readonly INFERRED = 'inferred';
  static readonly GUESS = 'guess';
  static readonly SCHEME_SET = new Set<string>([this.VERIFIED, this.INFERRED, this.GUESS]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class VisualizeLimits {
  static readonly SCHEMA_VERSION = 1;
  /** A figure beyond this is two figures. */
  static readonly MAX_NODES = 25;
  static readonly MAX_EDGES = 40;
  static readonly MAX_GRID = 10;
  static readonly MAX_STEPS = 12;
  static readonly MAX_ROWS_PER_TABLE = 30;
  static readonly MAX_TITLE = 120;
  static readonly MAX_SENTENCE = 300;
  static readonly MAX_LABEL = 60;
  /** An arrow label has to fit the gap between two boxes. */
  static readonly MAX_EDGE_LABEL = 20;
  static readonly MAX_DETAIL = 600;
  /** Typical pages are 20-40 KB; a page past `FAIL_BYTES` is refused: two pages, not one dense one. */
  static readonly WARN_BYTES = 60 * 1024;
  static readonly FAIL_BYTES = 100 * 1024;
  static readonly OUTPUT_DIRECTORY = 'prototypes';
}

/** The words of the page itself, English; a spec may override any of them (see `chrome`). */
export const DEFAULT_CHROME = {
  asOf: 'As of',
  scope: 'Scope',
  status: 'Status',
  statusStates: {
    ok: 'On track',
    warn: 'Needs attention',
    blocked: 'Blocked',
    info: 'For information',
  },
  healthy: 'Healthy?',
  blockedBy: 'Blocked by',
  changed: 'What changed',
  next: 'What needs action',
  flow: 'How it flows',
  legend: 'Legend',
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous',
  following: 'Next',
  step: 'Step',
  allSteps: 'All steps',
  detail: 'Detail',
  detailHint: 'Hover or focus a box for its detail.',
  before: 'Before',
  after: 'After',
  added: 'added',
  removed: 'removed',
  decisions: 'Decisions needed',
  recommended: 'Recommended',
  changesClaim: 'Changes',
  evidence: 'Evidence',
  claim: 'Claim',
  probe: 'Probe',
  result: 'Result',
  label: 'Basis',
  evidenceLabels: { verified: 'verified', inferred: 'inferred', guess: 'guess' },
  risks: 'Risks',
  risk: 'Risk',
  impact: 'Impact',
  fallback: 'Fallback',
  log: 'Log',
  links: 'Links',
  theme: 'Theme',
};
export type TChrome = typeof DEFAULT_CHROME;
