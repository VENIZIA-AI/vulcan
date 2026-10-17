import type { TConstValue } from '../../common/index.ts';
import type { SyncStatuses } from './constants.ts';

export type TSyncStatus = TConstValue<typeof SyncStatuses>;

export type TSettings = Record<string, unknown>;

/** One adapter `sync` would write; `apply` performs it, so a dry run only plans. */
export interface ISyncAction {
  path: string;
  status: TSyncStatus;
  note?: string;
  apply: () => void;
}
