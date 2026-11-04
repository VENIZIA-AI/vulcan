import type { TConstValue } from '../../../common/index.ts';
import type { IBoardEvent, IBoardFlow, IBoardDecision } from '../../common/index.ts';
import type { BoardLanguages } from './constants.ts';

export type TBoardLanguage = TConstValue<typeof BoardLanguages>;
export type TTranslate = (key: string) => string;

/** A line as the page draws it: a helper's line is its lane's, and keeps the helper's own names. */
export interface IBoardViewEvent extends IBoardEvent {
  /** The sender, when the line was drawn as its lane's. */
  as?: string;
  /** The recipient, when the line was drawn as its lane's. */
  asTo?: string;
}

/** What the list, the detail and the graph draw of one flow. */
export interface IFlowView {
  id: string;
  /** Only `flow` lines and plumbing: the flow has no work and no stage to show. */
  noWork: boolean;
  title: Pick<IBoardFlow, 'title' | 'repo' | 'why' | 'context' | 'next'> & { named: boolean };
  evs: IBoardViewEvent[];
  last: IBoardViewEvent;
  state: IBoardFlow['state'];
  holder: string;
  stages: number[];
  cur: number;
  /** The CI runs, reviews and releases of each stage, by stage. */
  att: Record<number, IBoardViewEvent[]>;
  lastAsk?: IBoardViewEvent;
  dec?: IBoardDecision;
  unread: boolean;
  newCount: number;
  approxLast: boolean;
}

/** One agent of the dock and the graph. */
export interface IAgentRow {
  n: string;
  helpers: number;
  st: 'blocked' | 'you' | 'working' | 'idle';
  flow: string | null;
  text: string;
  ts: string | null;
  approx: boolean;
  compact: boolean;
  /** Changes when the row has something new to say. */
  key: string;
}
