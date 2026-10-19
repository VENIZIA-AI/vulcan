import type { TConstValue } from '../../common/index.ts';
import type { AppSides } from './constants.ts';

export type TAppSide = TConstValue<typeof AppSides>;

/** One name init or add needs: the flag that carries it, the question that asks it. */
export interface INameField {
  key: string;
  flag: string;
  question: string;
  /** Only the shared folder may be left empty. */
  optional?: boolean;
  /** A folder the user chose before, offered as the answer; never a name VULCAN made up. */
  previous?: string;
}

export type TAsk = (opts: { question: string; previous?: string }) => string | null;

export type TNamesResult =
  | { ok: true; names: Record<string, string> }
  | { ok: false; error: string };
