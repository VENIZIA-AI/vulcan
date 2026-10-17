import type { TConstValue } from '@venizia/ignis-helpers/common';
import type { InitStatuses } from './constants.ts';

export type TInitStatus = TConstValue<typeof InitStatuses>;

/** One line of the init report: a file created or kept, or a line the user should add by hand. */
export interface IInitEntry {
  status: TInitStatus;
  subject: string;
}

/** A file `init` writes when absent, and the shipped template it comes from. */
export interface IScaffoldFile {
  path: string;
  template: string;
}
