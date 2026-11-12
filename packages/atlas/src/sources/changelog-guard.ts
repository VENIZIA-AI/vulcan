import { existsSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import type { IReleaseTable } from '@/releases';

const DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;

/**
 * A fetched source is not served with a release table that lost its changelog: the table is built from
 * git tags and the files of the changelog folder, and a checkout without those files gives releases
 * and no entry at all - a plan over it would read as an empty window. Refusing it keeps it out of the
 * cache, so the next start fetches again, and the notice names the reason. A folder a project declares
 * before it holds an entry is fine: only entries that exist - in the folder, or in the commit - count.
 */
export class ChangelogGuard {
  /** The dated entry files among `names`. */
  static datedIn(opts: { names: string[] }): number {
    return opts.names.filter((name) => DATED_ENTRY.test(name.split('/').pop() ?? name)).length;
  }

  /** `committed` is how many dated entries the fetched commit holds in the folder, when git can say. */
  static check(opts: {
    project: IAtlasProject;
    releases: IReleaseTable;
    label: string;
    committed?: number;
  }): void {
    const directory = opts.project.knowledge.changelogs;

    if (directory === undefined || opts.releases.changelogs.length > 0) {
      return;
    }

    const shown = relative(opts.project.root, directory);
    const onDisk = existsSync(directory)
      ? ChangelogGuard.datedIn({ names: readdirSync(directory) })
      : 0;

    if (onDisk === 0 && (opts.committed ?? 0) > 0) {
      throw new Error(
        `atlas: ${opts.label} commits ${opts.committed} dated entries in ${shown}, but the checkout holds none, so its release table holds no changelog entry`,
      );
    }

    if (onDisk > 0) {
      throw new Error(
        `atlas: ${opts.label} has ${onDisk} dated entries in ${shown}, but its release table holds none`,
      );
    }
  }
}
