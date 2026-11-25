import { VersionFolders, VersionSectionNames } from '@/changelogs/version-folder';
import type { IVersionFolder } from '@/changelogs/version-folder';
import { Resolve } from '@/changelogs/resolve';
import type { IAtlasProject } from '@/common/project-config';
import { BreakingBadge } from '@/migrations/badges';
import { ChangelogLayouts } from './common';
import type { IChangelogRecord, IReleaseRecord } from './common';

/** The release commits a version line spans: `from` is open, `to` is closed. A folded dated file inside it stands for a folder item. */
export interface IFolderLine {
  name: string;
  from: number;
  to: number;
}

interface IBuildOptions {
  project: IAtlasProject;
  folders: IVersionFolder[];
  /** The release records by package directory, orders final. */
  releases: Record<string, IReleaseRecord[]>;
  /** The order past every release: where work not yet released sits; absent without git history. */
  openOrder?: number;
}

const stableOf = (opts: { releases: Record<string, IReleaseRecord[]>; version: string }) =>
  Object.entries(opts.releases).flatMap(([dir, records]) =>
    records.filter((record) => record.version === opts.version).map((record) => ({ dir, record })),
  );

/**
 * The records of the version folders: one per item of every `log.md`, placed on the release line the way
 * a dated file is, so a window over versions reads them. A released line takes its date from `released:` and
 * its order from the stable tags of the packages the item names; the line in progress sits after every
 * release, dated by its newest prerelease tag.
 */
export class FolderRecords {
  /** The release window of each folder, for marking the dated files a folder covers. */
  static linesOf(opts: Pick<IBuildOptions, 'folders' | 'releases' | 'openOrder'>): IFolderLine[] {
    const stables = Object.values(opts.releases)
      .flat()
      .filter((record) => VersionFolders.isName({ name: record.version }));
    const lines: IFolderLine[] = [];
    let previous: number | undefined;

    for (const folder of opts.folders) {
      const before = stables
        .filter((record) => Bun.semver.order(record.version, folder.name) < 0)
        .map((record) => record.order);
      const from = Math.max(previous ?? -1, ...before);
      const own = stableOf({ releases: opts.releases, version: folder.name }).map(
        (entry) => entry.record.order,
      );
      const to =
        folder.released === undefined
          ? (opts.openOrder ?? Number.POSITIVE_INFINITY)
          : own.length === 0
            ? undefined
            : Math.max(...own);

      if (to === undefined) {
        previous = undefined;

        continue;
      }

      lines.push({ name: folder.name, from, to });
      previous = to;
    }

    return lines;
  }

  /** The folder a dated file at `order` was folded into, when one covers it. */
  static foldedInto(opts: { lines: IFolderLine[]; order: number | undefined }): string | undefined {
    const { order } = opts;

    return order === undefined
      ? undefined
      : opts.lines.find((line) => order > line.from && order <= line.to)?.name;
  }

  static build(opts: IBuildOptions): IChangelogRecord[] {
    return opts.folders.flatMap((folder) => {
      const date = FolderRecords.dateOf({ folder, releases: opts.releases });

      return folder.items.map((item) => {
        const named = item.packages.length === 0 ? folder.packages : item.packages;
        const packages = Resolve.resolveAll({ values: named, packages: opts.project.packages });
        const order = FolderRecords.orderOf({ ...opts, folder, packages });
        const block = folder.blocks[item.id];
        const isBreaking = item.section === VersionSectionNames.BREAKING;
        const record: IChangelogRecord = {
          id: `changelog:${folder.name}#${item.id}`,
          file: `${folder.name}/log.md`,
          date,
          title: item.title,
          packages,
          badge: isBreaking ? BreakingBadge.CANONICAL : item.section,
          layout: ChangelogLayouts.FOLDER,
          version: folder.name,
          section: item.section,
          ...(order === undefined ? {} : { order }),
        };

        if (isBreaking) {
          record.breaking = true;
        }

        if (block !== undefined) {
          record.migration = [VersionFolders.itemOf({ id: item.id, block })];
        }

        return record;
      });
    });
  }

  /** `released:` of a released line; for the line in progress the date of its newest prerelease tag, else of the newest release. */
  private static dateOf(opts: {
    folder: IVersionFolder;
    releases: Record<string, IReleaseRecord[]>;
  }): string {
    if (opts.folder.released !== undefined) {
      return opts.folder.released;
    }

    const all = Object.values(opts.releases).flat();
    const prereleases = all.filter((record) => record.version.startsWith(`${opts.folder.name}-`));
    const pool = prereleases.length > 0 ? prereleases : all;
    const newest = pool.reduce<IReleaseRecord | undefined>(
      (best, record) => (best === undefined || record.order > best.order ? record : best),
      undefined,
    );

    // No release, no tag of the line: it is in progress now.
    return newest?.date ?? new Date().toISOString().slice(0, 10);
  }

  /**
   * An item sits just after the newest stable release before its line, of the packages it names: a window that reaches any
   * release of the line - a prerelease included - then holds it, and a window that starts inside the line does not (the
   * state diff of `migrate` reads those from the tags). With several packages it sits after the latest of their prior stables, so
   * it is inside the window of each. Without git history there is no order.
   */
  private static orderOf(
    opts: IBuildOptions & { folder: IVersionFolder; packages: string[] },
  ): number | undefined {
    if (opts.openOrder === undefined) {
      return undefined;
    }

    const dirs = opts.packages.length > 0 ? opts.packages : Object.keys(opts.releases);
    const priors = dirs.map((dir) => {
      const stables = (opts.releases[dir] ?? [])
        .filter(
          (record) =>
            VersionFolders.isName({ name: record.version }) &&
            Bun.semver.order(record.version, opts.folder.name) < 0,
        )
        .map((record) => record.order);

      return Math.max(-1, ...stables) + 1;
    });

    return Math.max(0, ...priors);
  }
}
