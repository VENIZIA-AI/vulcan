import type { TConstValue } from '@venizia/vulcan-okf';
import type { IBoardEvent, IBoardFlow } from '../../common/index.ts';
import type {
  BoardAgentStatuses,
  BoardLanguages,
  BoardLiveStates,
  BoardSortOrders,
  BoardSwitches,
  BoardThemes,
  BoardWorkColumns,
  BoardWorkViews,
} from './constants.ts';

export type TBoardLanguage = TConstValue<typeof BoardLanguages>;
export type TSwitch = TConstValue<typeof BoardSwitches>;
export type TTheme = TConstValue<typeof BoardThemes>;
export type TLiveState = TConstValue<typeof BoardLiveStates>;
export type TWorkView = TConstValue<typeof BoardWorkViews>;
export type TWorkColumn = TConstValue<typeof BoardWorkColumns>;
export type TSortOrder = TConstValue<typeof BoardSortOrders>;
export type TAgentStatus = TConstValue<typeof BoardAgentStatuses>;
export type TTranslate = (key: string) => string;

/** A line as drawn. */
export type TBoardViewEvent = IBoardEvent;

/** What the list, the detail and the graph draw of one flow. */
export interface IFlowView {
  flow: IBoardFlow;
  holder: string;
  evs: TBoardViewEvent[];
  last: TBoardViewEvent;
  lastAsk?: TBoardViewEvent;
  /** Only `flow` lines and plumbing: no work, no stage to show. */
  noWork: boolean;
  newCount: number;
}

/** One agent of the dock and the graph. */
export interface IAgentRow {
  n: string;
  /** The newest moment the agent was heard from: its record or its last line. */
  lastAt: string | null;
  st: TAgentStatus;
  flow: string | null;
  /** The question that waits on the owner, when it is this agent's. */
  ask?: string;
  text: string;
  ts: string | null;
  approx: boolean;
  /** Changes when the row has something new to say. */
  key: string;
}
