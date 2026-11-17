import type { TConstValue } from '../../common/index.ts';
import type { IEventItem } from '../../events/common/index.ts';
import type { BoardRoutes, BoardStates, ProviderTypes } from './constants.ts';

export type TBoardState = TConstValue<typeof BoardStates>;
export type TProviderType = TConstValue<typeof ProviderTypes>;

/** The code host the board reads, with the host name GitLab is asked at. */
export interface IBoardProvider {
  type: TProviderType;
  host: string;
}
export type TBoardRoute = TConstValue<typeof BoardRoutes>;

export interface IBoardRef {
  repo?: string;
  pr?: number;
}

/** One line of a flow, in the shape the page draws. */
export interface IBoardEvent {
  id: string;
  /** `Unsorted` for a line with no flow. */
  flowId: string;
  ts: string;
  kind: string;
  /** -1 until the fold gives a message or an ask the stage its flow was at. */
  stage: number;
  actor: string;
  to?: string;
  /** A message the actor got, not sent (`msg-received`). */
  incoming?: boolean;
  /** Who sent a message the actor got, from a `from:<name>` ref. */
  from?: string;
  status?: string;
  /** What a decision decided: `approve`, `park` or `reject`. */
  choice?: string;
  needsOwner?: boolean;
  /** Agent plumbing: kept in the data, hidden by the page until "show all events". It never moves a flow. */
  plumbing?: boolean;
  /** This line names the flow: its summary is the title. */
  isTitle?: boolean;
  /** Only a title line has one: why the flow exists. */
  why?: string;
  /** Only a title line has them: what the flow is and what is left, and the next step. */
  context?: string;
  next?: string;
  /** Which attempt this is: the nth run of one check, the nth review round. */
  attempt?: number;
  /** The check a CI line is about. */
  check?: string;
  ref?: IBoardRef;
  link?: string;
  /** Only a title line has them: the lists, the due day and the tracker id the flow line gave. */
  steps?: IBoardItem[];
  checks?: IBoardItem[];
  apps?: string[];
  due?: string;
  tracker?: string;
  summary: string;
  source: string;
}

/** One step or acceptance check of a flow, and whether it is done: the same thing the event log carries. */
export type IBoardItem = IEventItem;

export interface IBoardFlow {
  id: string;
  title: string;
  /** The title came from a `flow` line; a flow without one shows the words of its pull request or its first line, with no marker. */
  named: boolean;
  /** Why the flow exists, from the newest `flow` line that has one. */
  why?: string;
  /** What the flow is, what is done and what is left; from the same line as the title. */
  context?: string;
  /** The next step and who does it; from the same line as the title. */
  next?: string;
  /** The steps, the acceptance checks, the apps, the due day and the tracker id, from the same line as the title: the line lists them in full. */
  steps?: IBoardItem[];
  checks?: IBoardItem[];
  apps?: string[];
  due?: string;
  tracker?: string;
  repo?: string;
  state: TBoardState;
  /** Who has it now. */
  holder: string;
  /** The stages reached, ascending, and the one it is at. */
  stages: number[];
  cur: number;
  /** The newest line that counts, and the ask that is waiting, by id. */
  lastId: string;
  askId?: string;
  ciRuns: number;
  reviewRounds: number;
  events: IBoardEvent[];
}

export interface IBoardDecision {
  choice: 'approve' | 'later' | 'reject';
  at: string;
}

/** What the page shows of one agent. */
export interface IBoardAgent {
  name: string;
  state: 'working' | 'idle';
  current: string;
  since: string;
  checkedAt: string;
  /** What the session start said of the session: the model, and the harness that wrote it. Never made up. */
  model?: string;
  harness?: string;
}

export interface IBoardData {
  /** The name on the page: `board.title`, else `<project name> Board`. */
  title: string;
  /** Who an ask waits on: `board.owner`, else `git config user.name`, else `Owner`. */
  owner: string;
  /** An SVG as a `data:` URL, from `board.logo`; none by default. */
  logo?: string;
  /** What the browser keys its saved choices by: the project name as a slug. */
  key: string;
  /** Agent name to face, from `board.agents`; any other agent has the default face. */
  shapes: Record<string, string>;
  /** The `board.agents` keys with no lane; absent when none is listed, and then every agent shows. */
  roster?: string[];
  /** A helper to the listed name it works under; shown as a label on its own card. */
  lanes?: Record<string, string>;
  /** What `board.agents` says an agent is, by name: `Backend`. */
  roles?: Record<string, string>;
  /** Set by `vulcan board serve`: where the page reads new snapshots from. The static file has none. */
  live?: { stream: string };
  generatedAt: string;
  since: string;
  flows: IBoardFlow[];
  decisions: Record<string, IBoardDecision>;
  agents: Record<string, IBoardAgent>;
  /** What each source gave, in words: `event log: 12 lines`, `github: skipped, gh is not installed`. */
  sources: string[];
}
