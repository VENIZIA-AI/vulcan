import type { TConstValue } from '../../common/index.ts';
import type { BoardStates } from './constants.ts';

export type TBoardState = TConstValue<typeof BoardStates>;

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
  status?: string;
  /** What a decision decided: `approve`, `park` or `reject`. */
  choice?: string;
  needsOwner?: boolean;
  /** Which attempt this is: the nth run of one check, the nth review round. */
  attempt?: number;
  /** The check a CI line is about. */
  check?: string;
  ref?: IBoardRef;
  link?: string;
  summary: string;
  source: string;
}

export interface IBoardFlow {
  id: string;
  title: string;
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
}

export interface IBoardData {
  generatedAt: string;
  since: string;
  flows: IBoardFlow[];
  decisions: Record<string, IBoardDecision>;
  agents: Record<string, IBoardAgent>;
  /** What each source gave, in words: `event log: 12 lines`, `github: skipped, gh is not installed`. */
  sources: string[];
}
