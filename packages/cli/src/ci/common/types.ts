import type { TConstValue } from '../../common/index.ts';
import type { AffectedReasons, CiChecks } from './constants.ts';

export type TCiCheck = TConstValue<typeof CiChecks>;
export type TAffectedReason = TConstValue<typeof AffectedReasons>;

/** A package of the workspace, as its `package.json` says. */
export interface IWorkspacePackage {
  name: string;
  /** Relative to the root, with `/`. */
  dir: string;
  scripts: Record<string, string>;
  /** Every dependency of every field: the name and the spec it is declared with. */
  dependencies: IDependency[];
}

export interface IDependency {
  name: string;
  spec: string;
}

export interface IAffectedPackage {
  name: string;
  dir: string;
  reason: TAffectedReason;
  /** The checks the package has: the check name to the script that runs it. */
  checks: Partial<Record<TCiCheck, string>>;
}

export interface IAffectedResult {
  base: string;
  head: string;
  /** Whether every package is on the list, and the file or the fact that made it so. */
  all: boolean;
  allBecause?: string;
  packages: IAffectedPackage[];
}
