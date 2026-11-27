import type { TConstValue } from '../../common/index.ts';
import type { LibraryTypes, PackageTypes } from './constants.ts';

export type TPackageType = TConstValue<typeof PackageTypes>;
export type TLibraryType = TConstValue<typeof LibraryTypes>;

/** One file the codemod writes (`text`) or deletes (no `text`), by path relative to the project root. */
export interface IFileChange {
  path: string;
  text?: string;
}

export type TCodemodResult =
  | { ok: true; changes: IFileChange[]; notes: string[] }
  | { ok: false; reason: string };

/** A property of the config, cut into the text that moves with it, and where it goes. */
export interface ICodemodItem {
  group: string;
  key: string;
  leading: string;
  /** The text from the property's first token to its end, without the comma (`key: value` or a shorthand). */
  body: string;
  /** The text after the comma up to the end of the line: a trailing comment and the line break. */
  trailing: string;
  /** The column the property started at in the file it came from. */
  column: number;
  /** The value alone, for a property that is the whole group (`guard`), or the identifier a shorthand names. */
  value?: string;
  /** The identifier the value is, when it is one (a module of the old split). */
  identifier?: string;
}
