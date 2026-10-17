import type { IPackageMapEntry } from '@/common/package-map';

/** One published version of one package, as `scripts/atlas-releases.ts` read it off a release commit. */
export interface IReleaseRecord {
  version: string;
  date: string;
  sha: string;
  /** Release commits before this one in first-parent history (a commit position in tables before 0.2.0-0); absent in older tables. */
  order?: number;
}

/**
 * One dated changelog entry. `id` is the same citation id `search` and `get` use, so an entry a
 * window returned can be read in full; `packages` is empty when the file names no package.
 */
export interface IChangelogRecord {
  /** The source it came from, when atlas serves more than one. */
  source?: string;
  id: string;
  file: string;
  date: string;
  title: string;
  packages: string[];
  kind: string | null;
  /** Release commits before the commit that added the file, all of them while it is uncommitted (a commit position before 0.2.0-0); absent in older tables. */
  order?: number;
}

/** The generated `releases.json` payload, whole. Release lists are newest first, per package. */
export interface IReleaseTable {
  /** The package directories that exist today; `releases` also holds retired ones, whose history stays readable. */
  livePackages?: string[];
  releases: Record<string, IReleaseRecord[]>;
  changelogs: IChangelogRecord[];
  /** Every package's directory, npm name and other names; absent in a table generated before 0.2.0-0. */
  packageMap?: IPackageMapEntry[];
}

/** What the tools read from release tables - one source's store, or several served as one. */
export interface IReleaseIndex {
  /** Why there is no release: no git history, or no tag the pattern reads. */
  readonly emptyReason: string;
  /** Why a date window has nothing to read: where atlas looked for dated entries, and how they are named. */
  readonly noEntriesReason: string;
  isEmpty(): boolean;
  packages(): string[];
  livePackages(): string[];
  entryDates(): string[];
  packageOf(opts: { package: string }): string;
  /** Whether the project declares the package, released or not. */
  declares(opts: { package: string }): boolean;
  versionsOf(opts: { package: string }): string[];
  newestOf(opts: { package: string }): IReleaseRecord | undefined;
  releaseDateOf(opts: { package: string; version: string }): string | undefined;
  releaseOrderOf(opts: { package: string; version: string }): number | undefined;
  entriesBetween(opts: { package?: string; fromDate: string; toDate: string }): IChangelogRecord[];
  entriesBetweenOrders(opts: {
    package?: string;
    fromOrder: number;
    toOrder: number;
    fromDate: string;
    toDate: string;
  }): IChangelogRecord[];
}
