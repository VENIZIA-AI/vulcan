import type { TConstValue } from '../../../common/index.ts';
import type { IBoardEvent, IBoardFlow } from '../../common/index.ts';
import type { BoardLanguages } from './constants.ts';

export type TBoardLanguage = TConstValue<typeof BoardLanguages>;
export type TTranslate = (key: string) => string;

/** A line as drawn. */
export type IBoardViewEvent = IBoardEvent;

/** What the list, the detail and the graph draw of one flow. */
export interface IFlowView {
  flow: IBoardFlow;
  holder: string;
  evs: IBoardViewEvent[];
  last: IBoardViewEvent;
  lastAsk?: IBoardViewEvent;
  /** Only `flow` lines and plumbing: no work, no stage to show. */
  noWork: boolean;
  newCount: number;
}

/** One agent of the dock and the graph. */
export interface IAgentRow {
  n: string;
  /** The newest moment the agent was heard from: its record or its last line. */
  lastAt: string | null;
  st: 'blocked' | 'you' | 'working' | 'idle';
  flow: string | null;
  /** The question that waits on the owner, when it is this agent's. */
  ask?: string;
  text: string;
  ts: string | null;
  approx: boolean;
  /** Changes when the row has something new to say. */
  key: string;
}
