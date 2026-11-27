import type { TConstValue } from '../../common/index.ts';
import type { BaseRuleChanges, GitTrackStates, SyncStatuses } from './constants.ts';

type TSyncStatus = TConstValue<typeof SyncStatuses>;

export type TSettings = Record<string, unknown>;

/** One adapter `sync` would write; `apply` performs it, so a dry run only plans. */
export interface ISyncAction {
  path: string;
  status: TSyncStatus;
  note?: string;
  apply: () => void;
}

type TBaseRuleChange = TConstValue<typeof BaseRuleChanges>;

/** One base rule that moved since the last sync; `text` is its new text, empty for a removed rule. */
export interface IBaseRuleChange {
  id: string;
  change: TBaseRuleChange;
  text: string;
}

export type TGitTrackState = TConstValue<typeof GitTrackStates>;
