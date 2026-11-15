import type { IPackageMapEntry } from '@/common/package-map';
import type { IVersionFolder, TVersionSection } from '@/changelogs/version-folder';
import type { TConstValue } from '@/common/types';
import type { TMigrationItem } from '@/migrations/schema';

/** Where a changelog record was read from. */
export class ChangelogLayouts {
  /** A dated file `YYYY-MM-DD-slug.md`: one record per file. */
  static readonly DATED = 'dated';
  /** An item of `changelogs/<X.Y.Z>/log.md`: one record per item. */
  static readonly FOLDER = 'folder';
}

export type TChangelogLayout = TConstValue<typeof ChangelogLayouts>;

/** What reading the folder of a line at a release tag found. */
export class FolderAtKinds {
  /** The folder, as the tag held it. */
  static readonly FOLDER = 'folder';
  /** The tag holds no folder of that line: the line was folded in after the release. */
  static readonly ABSENT = 'absent';
  /** Git cannot say (no such tag here, a blob a partial clone lacks): the reader degrades and says so. */
  static readonly UNREADABLE = 'unreadable';
}

export type TFolderAt =
  | { kind: typeof FolderAtKinds.FOLDER; tag: string; folder: IVersionFolder }
  | { kind: typeof FolderAtKinds.ABSENT; tag: string }
  | { kind: typeof FolderAtKinds.UNREADABLE; tag?: string; reason: string };

/** The version folders of one source: at HEAD, and as a release tag of a package held them. */
export interface IFolderHistory {
  /** Every version folder at HEAD (the final folders), oldest first. */
  folders(): IVersionFolder[];
  /** The folder of `line` at the tag of `package` `version` (npm name). */
  at(opts: { package: string; version: string; line: string }): TFolderAt;
}

/** One published version of one package, as `vulcan x atlas releases` reads it off a release commit. */
export interface IReleaseRecord {
  version: string;
  date: string;
  sha: string;
  /** Release commits before this one in first-parent history. */
  order: number;
  /** The tag the release was read from, set only when a legacy template read it; a current tag is rebuilt from `tagPattern`. */
  tag?: string;
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
  /** Present and true when any badge of the entry says breaking, whichever it is first: `kind` is only the first. */
  breaking?: true;
  /** How an app migrates across the entry: present only when the file's `migration` block is valid. */
  migration?: TMigrationItem[];
  /** Release commits before the commit that added the file, all of them while it is uncommitted; absent when the project has no git history. */
  order?: number;
  /** `folder` for an item of a version folder; absent reads as `dated`. */
  layout?: TChangelogLayout;
  /** A folder item: the version folder (the stable the line releases) and the section it sits in. */
  version?: string;
  section?: TVersionSection;
  /** A dated file whose release window a version folder covers: a window that holds the folder's items leaves it out, one that does not keeps it. */
  foldedInto?: string;
}

/** The generated `releases.json` payload, whole. Release lists are newest first, per package. */
export interface IReleaseTable {
  /** The package directories that exist today; `releases` also holds retired ones, whose history stays readable. */
  livePackages: string[];
  releases: Record<string, IReleaseRecord[]>;
  changelogs: IChangelogRecord[];
  /** The version folders the table read, even those whose `log.md` holds no item; absent in a table built before folders. */
  versionFolders?: string[];
  /** Every package's directory, npm name and other names. */
  packageMap: IPackageMapEntry[];
}

/** What the tools read from release tables - one source's store, or several served as one. */
export interface IReleaseIndex {
  /** Why there is no release: no git history, or no tag the pattern reads. */
  readonly emptyReason: string;
  /** Why a date window has nothing to read: where atlas looked for dated entries, and how they are named. */
  readonly noEntriesReason: string;
  isEmpty(): boolean;
  packages(): string[];
  /** Every package the project declares or has released, sorted - what a "known packages" list offers. */
  declaredPackages(): string[];
  livePackages(): string[];
  entryDates(): string[];
  packageOf(opts: { package: string }): string;
  /** Whether the project declares the package, released or not. */
  declares(opts: { package: string }): boolean;
  versionsOf(opts: { package: string }): string[];
  newestOf(opts: { package: string }): IReleaseRecord | undefined;
  releaseDateOf(opts: { package: string; version: string }): string | undefined;
  releaseOrderOf(opts: { package: string; version: string }): number | undefined;
  /** The words of the command that runs the codemods of the source that serves `package`; absent when it sets none (the default runner). */
  codemodCommandOf(opts: { package: string }): string[] | undefined;
  /** The npm names of every package the source that serves `package` declares: the only places its codemod runner may be installed from. */
  codemodPackagesOf(opts: { package: string }): string[];
  /** The version folders of the source that serves `package`, at HEAD and at its tags; absent when the source keeps none. */
  folderHistoryOf(opts: { package: string }): IFolderHistory | undefined;
  /**
   * `includeFolded` keeps the dated files a version folder covers; by default the folder's items stand for them when the
   * window holds those items. `datedOnly` leaves the folder items out - `migrate` reads them as states - and then drops
   * every dated file a folder covers unless `includeFolded` keeps it.
   */
  entriesBetween(opts: {
    package?: string;
    fromDate: string;
    toDate: string;
    includeFolded?: boolean;
    datedOnly?: boolean;
  }): IChangelogRecord[];
  entriesBetweenOrders(opts: {
    package?: string;
    fromOrder: number;
    toOrder: number;
    fromDate: string;
    toDate: string;
    includeFolded?: boolean;
    datedOnly?: boolean;
  }): IChangelogRecord[];
}
