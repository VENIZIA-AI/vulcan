import type { TConstValue } from '../../../common/index.ts';
import type { IBoardDecision, IBoardEvent, IBoardFlow } from '../../common/index.ts';
import type { BoardLanguages } from './constants.ts';

export type TBoardLanguage = TConstValue<typeof BoardLanguages>;
export type TTranslate = (key: string) => string;

/** A line as drawn: a helper's line is its lane's, and keeps the helper's names in `as` and `asTo`. */
export interface IBoardViewEvent extends IBoardEvent {
  as?: string;
  asTo?: string;
}

/** What the list, the detail and the graph draw of one flow. */
export interface IFlowView {
  flow: IBoardFlow;
  /** The lane of the flow's holder. */
  holder: string;
  evs: IBoardViewEvent[];
  last: IBoardViewEvent;
  /** The CI runs, reviews and releases of each stage. */
  att: Record<number, IBoardViewEvent[]>;
  lastAsk?: IBoardViewEvent;
  dec?: IBoardDecision;
  /** The flow has a title of its own; the `Unsorted` one never has, and is not asked for one. */
  named: boolean;
  /** Only `flow` lines and plumbing: no work, no stage to show. */
  noWork: boolean;
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
  /** Changes when the row has something new to say. */
  key: string;
}
