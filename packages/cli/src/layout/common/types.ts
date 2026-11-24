import type { TConstValue } from '../../common/types.ts';
import type { LayoutRules } from './constants.ts';

export type TLayoutRule = TConstValue<typeof LayoutRules>;

/** One finding of the layout check: the rule, the file or folder, and what to do. */
export interface ILayoutFinding {
  rule: TLayoutRule;
  /** Repository-relative path of the file, or of the folder for `mixed-folder`. */
  path: string;
  message: string;
}

/** What the check reads of a file: how many lines it has, and its first lines (where a generated header is). */
export interface ILayoutFileText {
  lines: number;
  head: string;
}
