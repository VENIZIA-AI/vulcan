import { BaseHelper } from '@/common/helper';
import { packageOfDirectory, packageOfQuery } from '@/common/package-map';
import type { IPackageMapEntry } from '@/common/package-map';
import type { IChangelogRecord, IReleaseRecord, IReleaseTable } from './common';

const byText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

/**
 * The generated release table in memory: which versions of a package exist, when each shipped, and
 * which changelog entries fall between two dates. One instance per server - the table never
 * changes while the process runs.
 */
export class ReleaseStore extends BaseHelper {
  private readonly releases = new Map<string, IReleaseRecord[]>();
  private readonly changelogs: IChangelogRecord[];
  private readonly live: string[];
  private readonly packageMap: IPackageMapEntry[];
  /** What `version` and `changes` say when the table holds no release. */
  readonly emptyReason: string;
  /** What `changes` says when the table holds no dated changelog entry. */
  readonly noEntriesReason: string;

  constructor(opts: { table: IReleaseTable; emptyReason?: string; noEntriesReason?: string }) {
    super({ scope: ReleaseStore.name });

    this.packageMap = opts.table.packageMap ?? [];
    this.emptyReason = opts.emptyReason ?? 'no releases';
    this.noEntriesReason = opts.noEntriesReason ?? 'no dated changelog entries';

    const tableReleasesEntries = Object.entries(opts.table.releases ?? {});

    // The table is keyed by directory; the store by npm name, the identity every answer carries.
    const nameOf = (dir: string): string =>
      packageOfDirectory({ dir, packageMap: this.packageMap });

    for (const [dir, records] of tableReleasesEntries) {
      this.releases.set(nameOf(dir), records);
    }

    // Newest first, so every window answers in that order without re-sorting.
    this.changelogs = [...(opts.table.changelogs ?? [])]
      .map(entry => ({ ...entry, packages: entry.packages.map(nameOf) }))
      .sort((left, right) => byText(right.date, left.date));
    this.live = [...(opts.table.livePackages ?? [])].map(nameOf).sort(byText);
  }

  /** Whether no table was loaded at all - distinct from a table that simply does not carry a package. */
  isEmpty(): boolean {
    return this.releases.size === 0 && this.changelogs.length === 0;
  }

  /** Every package the release table knows, sorted. */
  packages(): string[] {
    return [...this.releases.keys()].sort(byText);
  }

  /** Every date a changelog entry carries, newest first, each date once. */
  entryDates(): string[] {
    return [...new Set(this.changelogs.map(record => record.date))];
  }

  /** The table's package map - how a composite of sources routes a package to its owner. */
  packageMapEntries(): IPackageMapEntry[] {
    return this.packageMap;
  }

  /** A package a tool was asked about, as its npm name - what the store is keyed by. */
  packageOf(opts: { package: string }): string {
    return packageOfQuery({ value: opts.package, packageMap: this.packageMap });
  }

  /** The packages that exist today; a table generated before this list existed answers with every package it knows. */
  livePackages(): string[] {
    return this.live.length > 0 ? this.live : this.packages();
  }

  /** Every known version of one package, newest first; an unknown package has none. */
  versionsOf(opts: { package: string }): string[] {
    return this.recordsOf(opts).map(record => record.version);
  }

  /** The date one version shipped on, or `undefined` when the table never saw it. */
  releaseDateOf(opts: { package: string; version: string }): string | undefined {
    return this.recordsOf(opts).find(record => record.version === opts.version)?.date;
  }

  /** The newest release of one package, or `undefined` when the table never saw it. */
  newestOf(opts: { package: string }): IReleaseRecord | undefined {
    return this.recordsOf(opts)[0];
  }

  /**
   * The changelog entries in `fromDate < date <= toDate`, newest first. The lower bound is open so
   * the release that opens a window is not counted twice; the upper bound is closed so the release
   * that closes it carries its own entries.
   */
  entriesBetween(opts: { package?: string; fromDate: string; toDate: string }): IChangelogRecord[] {
    const wanted =
      opts.package === undefined ? undefined : this.packageOf({ package: opts.package });

    return this.changelogs.filter(entry => {
      if (entry.date <= opts.fromDate || entry.date > opts.toDate) {
        return false;
      }

      return wanted === undefined || entry.packages.includes(wanted);
    });
  }

  /**
   * The same window keyed by commit position instead of date, for two releases of one day: a date
   * window between them is empty, and their commit order is the only thing that separates them.
   * An entry with no recorded position falls back to its date against the bounds' dates.
   */
  entriesBetweenOrders(opts: {
    package?: string;
    fromOrder: number;
    toOrder: number;
    fromDate: string;
    toDate: string;
  }): IChangelogRecord[] {
    const wanted =
      opts.package === undefined ? undefined : this.packageOf({ package: opts.package });

    return this.changelogs.filter(entry => {
      const inside =
        entry.order === undefined
          ? entry.date > opts.fromDate && entry.date <= opts.toDate
          : entry.order > opts.fromOrder && entry.order <= opts.toOrder;

      if (!inside) {
        return false;
      }

      return wanted === undefined || entry.packages.includes(wanted);
    });
  }

  /** The recorded commit position of one release, or `undefined` when the table carries none. */
  releaseOrderOf(opts: { package: string; version: string }): number | undefined {
    return this.recordsOf(opts).find(record => record.version === opts.version)?.order;
  }

  private recordsOf(opts: { package: string }): IReleaseRecord[] {
    return this.releases.get(this.packageOf({ package: opts.package })) ?? [];
  }
}
