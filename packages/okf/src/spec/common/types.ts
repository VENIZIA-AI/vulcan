import type { TConstValue } from '@venizia/ignis-helpers/common';
import type { IssueSeverities } from './constants.ts';

export type TIssueSeverity = TConstValue<typeof IssueSeverities>;

/** A markdown file of the bundle; `path` is relative to the bundle root, `/`-separated. */
export interface IBundleFile {
  path: string;
  text: string;
}

/** `rule` cites the OKF v0.2 section, e.g. `§11.2`. Errors break conformance; warnings are soft guidance. */
export interface IConformanceIssue {
  file: string;
  rule: string;
  severity: TIssueSeverity;
  message: string;
}
