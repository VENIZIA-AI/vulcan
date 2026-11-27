import type { TConstValue } from '../common/index.ts';
import { ConstClass } from '../common/types.ts';

/** Which side of a before/after page a row is on: what was added, what was removed. */
export class ChangeKinds {
  static readonly ADDED = 'added';
  static readonly REMOVED = 'removed';
}

export type TChangeKind = TConstValue<typeof ChangeKinds>;

export class StatusStates extends ConstClass {
  static readonly OK = 'ok';
  static readonly WARN = 'warn';
  static readonly BLOCKED = 'blocked';
  static readonly INFO = 'info';
}

/** Where a task stands on the minimap: a shape and a word each, never colour alone. */
export class MinimapStates extends ConstClass {
  static readonly DONE = 'done';
  static readonly IN_PROGRESS = 'in progress';
  static readonly WAITING = 'waiting';
  static readonly NOT_STARTED = 'not started';
  static readonly BLOCKED = 'blocked';
  static readonly DROPPED = 'dropped';

  /** The class and chrome key of a state: the words have spaces, the keys do not. */
  static keyOf(value: string): string {
    return value.replaceAll(' ', '-');
  }
}

/** The state of a box, a milestone or a chart part: a minimap state, or plain information. Never told by colour alone. */
export class NodeStates {
  static readonly SCHEME_SET = new Set<string>([...MinimapStates.values(), 'info']);

  /** The colour family of a state: green, blue, amber, red, or neutral. */
  static toneOf(value: string): string {
    const tones: Record<string, string> = {
      done: 'ok',
      'in progress': 'info',
      waiting: 'warn',
      blocked: 'bad',
      info: 'info',
    };

    return tones[value] ?? 'mut';
  }

  /** The icon of a state. */
  static iconOf(value: string): string {
    return MinimapStates.keyOf(value) === 'in-progress'
      ? 'progress'
      : MinimapStates.keyOf(value).replaceAll('-', '');
  }
}

/** How an edge reads: the main path, a branch, a return, a fan-out or a failure. Never by colour alone. */
export class EdgeVariants extends ConstClass {
  static readonly MAIN = 'main';
  static readonly BRANCH = 'branch';
  static readonly RETURN = 'return';
  static readonly FANOUT = 'fanout';
  static readonly ERROR = 'error';
}

export class NodeKinds extends ConstClass {
  static readonly STEP = 'step';
  static readonly SERVICE = 'service';
  static readonly STORE = 'store';
  static readonly ACTOR = 'actor';
  static readonly EXTERNAL = 'external';
}

/** What a claim in the evidence table rests on. An analogy is never shown as a fact. */
export class EvidenceLabels extends ConstClass {
  static readonly VERIFIED = 'verified';
  static readonly INFERRED = 'inferred';
  static readonly GUESS = 'guess';
}

export class VisualizeLimits {
  static readonly SCHEMA_VERSION = 1;
  /** A figure beyond this is two figures. */
  static readonly MAX_NODES = 25;
  static readonly MAX_EDGES = 40;
  static readonly MAX_GRID = 10;
  static readonly MAX_STEPS = 12;
  static readonly MAX_ROWS_PER_TABLE = 30;
  static readonly MAX_TITLE = 60;
  static readonly MAX_SENTENCE = 300;
  static readonly MAX_LABEL = 60;
  /** An arrow label has to fit the gap between two boxes. */
  static readonly MAX_EDGE_LABEL = 20;
  static readonly MAX_DETAIL = 600;
  static readonly MAX_COMPARE_OPTIONS = 6;
  static readonly MAX_CRITERIA = 8;
  static readonly MAX_BRANCHES = 8;
  static readonly MAX_BRANCH_ITEMS = 6;
  static readonly MAX_EXPLAINER_STEPS = 8;
  static readonly MAX_LAYERS = 5;
  static readonly MAX_LAYER_BOXES = 6;
  static readonly MAX_LINKS = 20;
  static readonly MAX_TIMELINE = 20;
  static readonly MAX_TILES = 6;
  static readonly MAX_CHARTS = 6;
  static readonly MAX_POINTS = 12;
  static readonly MAX_STACK_SERIES = 8;
  static readonly MAX_TABLE_COLUMNS = 6;
  static readonly MAX_TABLE_ROWS = 12;
  static readonly MAX_METERS = 8;
  static readonly MAX_CELL = 60;
  static readonly MAX_SERIES = 5;
  static readonly MAX_PARTS = 12;
  static readonly MAX_LIST = 6;
  /** A step of the plan is a name and a note that read on one line each. */
  static readonly MAX_STEP_NAME = 40;
  static readonly MAX_STEP_NOTE = 80;
  /** A decision is a question, two or three options and a reason; the code goes in its detail. */
  static readonly MAX_QUESTION = 80;
  static readonly MAX_OPTION_LABEL = 24;
  static readonly MAX_OPTION_EFFECT = 120;
  static readonly MAX_WHY = 160;
  static readonly MAX_DECISION_DETAIL = 300;
  /** Body blocks of a written section. */
  static readonly MAX_SECTIONS = 6;
  static readonly MAX_BLOCKS = 12;
  static readonly MAX_CODE_LINES = 40;
  static readonly MAX_CODE_LINE = 120;
  /** Typical pages are 30-60 KB; a page past `FAIL_BYTES` is refused: two pages, not one dense one. */
  static readonly WARN_BYTES = 80 * 1024;
  static readonly FAIL_BYTES = 150 * 1024;
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
  next: 'What you need to do',
  minimap: 'Steps',
  task: 'Task',
  minimapStates: {
    done: 'done',
    'in-progress': 'in progress',
    waiting: 'waiting',
    'not-started': 'not started',
    blocked: 'blocked',
    dropped: 'dropped',
    info: 'for information',
  },
  actions: 'Do these, in order',
  footer: 'Static page by vulcan page new; it loads nothing.',
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
  evidence: 'Evidence',
  claim: 'Claim',
  probe: 'Probe',
  result: 'Result',
  label: 'Basis',
  evidenceLabels: { verified: 'verified', inferred: 'inferred', guess: 'guess' },
  /** The words of the flow legend: what a box is, and how an arrow reads. */
  nodeKinds: {
    step: 'step',
    service: 'service',
    store: 'store',
    actor: 'actor',
    external: 'external',
  },
  edgeVariants: {
    main: 'main',
    branch: 'branch',
    return: 'return',
    fanout: 'fan-out',
    error: 'error',
  },
  risks: 'Risks',
  risk: 'Risk',
  impact: 'Impact',
  fallback: 'Fallback',
  log: 'Log',
  links: 'Links',
  theme: 'Theme',
  present: 'Present',
  exitPresent: 'Exit',
  slide: 'Slide',
  slideOf: 'of',
  comparison: 'Comparison',
  total: 'Total score',
  outOf: 'out of',
  pros: 'For',
  cons: 'Against',
  ideaMap: 'Idea map',
  explainer: 'How it works',
  architecture: 'Architecture',
  timeline: 'Timeline',
  findings: 'Findings',
  decisionRecord: 'Decision record',
  context: 'Context',
  optionsConsidered: 'Options considered',
  decision: 'Decision',
  chosen: 'Chosen',
  consequences: 'Consequences',
  tableView: 'Table view',
  value: 'Value',
  uses: 'Uses',
  /** The theme switch says what a click does. */
  themeToLight: 'Switch to the light theme',
  themeToDark: 'Switch to the dark theme',
  /** The label of the in-page links in the top bar. */
  navLabel: 'On this page',
  sequence: 'Sequence',
  lifecycle: 'Lifecycle',
  tree: 'Structure',
  compareView: 'What differs',
  inBoth: 'in both',
  sources: 'Sources',
  terms: 'Words in this page',
  grades: 'Grades',
  gradeA: 'good',
  gradeB: 'has gaps',
  gradeC: 'weak',
  metrics: 'Numbers',
  why: 'Why',
  other: 'Other',
  limit: 'Limit',
  trendUp: 'rising',
  trendDown: 'falling',
  trendFlat: 'flat',
  /** The words that tell an added arrow from a removed one: never colour alone. */
  onlyHere: 'only here',
  addedEdge: 'added',
  removedEdge: 'removed',
  /** The words of the sequence, lifecycle and tree figures: a message kind, a state kind, and the counts in their captions. */
  kindCall: 'call',
  kindReply: 'reply',
  kindAsync: 'async',
  stateStart: 'start',
  stateEnd: 'end',
  countMessages: 'messages',
  countStates: 'states',
  countTransitions: 'transitions',
  countItems: 'items',
};
export type TChrome = typeof DEFAULT_CHROME;

/** The sizes and words the figures of the sequence, the lifecycle and the tree share. */
export class KindFigureConstants {
  /** The few words these figures say that the page's words may not have yet: English until the chrome has them. */
  static readonly WORDS = {
    kindCall: 'call',
    kindReply: 'reply',
    kindAsync: 'async',
    stateStart: 'start',
    stateEnd: 'end',
    countMessages: 'messages',
    countStates: 'states',
    countTransitions: 'transitions',
    countItems: 'items',
  } as const;

  static readonly MARGIN = 24;
  /** No figure is narrower than this, so on a phone (390 px) the list always takes its place. */
  static readonly MIN_WIDTH = 480;
  static readonly LABEL_PX = 8.2;
  static readonly SMALL_PX = 6.6;
}

/** Where the theme of a page came from. */
export class ThemeSources {
  static readonly SPEC = 'spec';
  static readonly PROJECT = 'project';
  static readonly DEFAULT = 'default';
}

export type TThemeSource = TConstValue<typeof ThemeSources>;

/** The forms a bar chart's data takes. */
export class BarForms {
  static readonly STATS = 'stats';
  static readonly LINE = 'line';
  static readonly BARS = 'bars';
}

export type TBarForm = TConstValue<typeof BarForms>;

/** The forms the parts of a whole take. */
export class PartsForms {
  static readonly SEGMENTED = 'segmented';
  static readonly RANKED = 'ranked';
}

export type TPartsForm = TConstValue<typeof PartsForms>;

/** The two ends of a link. */
export class LinkEnds {
  static readonly FROM = 'from';
  static readonly TO = 'to';
}

export type TLinkEnd = TConstValue<typeof LinkEnds>;

/** Which way an arrow head points. */
export class ArrowDirections {
  static readonly UP = 'up';
  static readonly DOWN = 'down';
}

export type TArrowDirection = TConstValue<typeof ArrowDirections>;

/** Where an SVG text is anchored. */
export class TextAnchors {
  static readonly MIDDLE = 'middle';
  static readonly START = 'start';
  static readonly END = 'end';
}

export type TTextAnchor = TConstValue<typeof TextAnchors>;
