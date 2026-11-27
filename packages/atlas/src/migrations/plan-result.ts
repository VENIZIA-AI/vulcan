import type { ISourceNotice } from '@/server/notice';
import type { TConstValue } from '@/common/types';
import type { IMigrationTouch } from './scan';
import type { TMigrationDirection } from './schema';
import type { TMigrateDirection, TStepDirection } from './directions';

export class MigrateTargets {
  /** `to` was `latest` or `next`: read from the release table; npm is asked only to say whether the table is behind it. */
  static readonly RELEASE_TABLE = 'release table';
  static readonly VERSION = 'version';
}

export type TMigrateTarget = TConstValue<typeof MigrateTargets>;

/** One migration item of the window, in the direction the plan runs. */
export interface IMigrationStep {
  id: string;
  /** The changelog entry the item is from: `get` reads it in full. */
  entry: string;
  title: string;
  date: string;
  symbols: string[];
  /** Which way this step moves the app: `downgrade` undoes the item, `upgrade` applies it. A plan can hold both. */
  direction: TStepDirection;
  /** The item's `upgrade` for an upgrade step, its `downgrade` for a downgrade step. */
  change: TMigrationDirection;
  /** The item is in both versions and changed in between: it is undone as it was, then applied as it is. */
  changed?: true;
  data?: string;
  codemod?: string;
  /** Where the item's upgrade guide is on the source's wiki; set for a version-folder item when the source names its wiki. */
  guide?: string;
  /** Where the app's code reaches the item's symbols; empty when it does not. */
  touches: IMigrationTouch[];
}

/** A breaking entry of the window with no structured block: read it with `get`. */
export interface IUnstructuredEntry {
  id: string;
  title: string;
  date: string;
}

export interface IMigrationPlan {
  package: string;
  from: string;
  to: string;
  direction: TMigrateDirection;
  /** Where `to` came from: the release table (`latest`, `next`) or the version as given. */
  target: TMigrateTarget;
  /** How many changelog entries of the package fall in the window, with a migration block or not: 0 means the release table holds none between the two versions. */
  entries: number;
  /** The command that runs the codemods the steps link; absent when no step links one. */
  apply?: string;
  /** What `apply` runs the linked codemods with: the `knowledge.codemodCommand` of the source that serves the package (default `devz codemod`); set with `apply`. */
  codemodCommand?: string[];
  /** The packages of that source: the runner's binary must be installed inside one of them; set with `apply`. */
  codemodPackages?: string[];
  /** A warning about how to read the plan, e.g. `latest` is older than the installed version; absent otherwise. */
  note?: string;
  /** Set when the folder state of an end of the plan could not be read exactly (a tag git could not show): the steps may be wrong, so `apply` runs none of them without `--force`. */
  degraded?: true;
  /** Set when npm is ahead of the atlas source's ref: the plan stops short of what npm publishes. */
  behind?: string;
  steps: IMigrationStep[];
  unstructured: IUnstructuredEntry[];
  /** Files of the app that could not be read; the scan covered the rest. */
  unreadable: string[];
}

/** A package left out of a run over every installed package, with why. */
export interface ISkippedPackage {
  package: string;
  reason: string;
}

export interface IMigrationResult {
  app: string;
  /** Added by the server when a declared source was still indexing or could not be served: the plans cover only the rest. */
  notServed?: ISourceNotice;
  plans: IMigrationPlan[];
  skipped: ISkippedPackage[];
  /** Installed packages no atlas source serves, in a run over every installed package: VULCAN itself is one in every project. */
  unserved: string[];
}
