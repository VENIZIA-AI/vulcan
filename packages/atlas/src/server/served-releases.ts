import { relative } from 'node:path';
import { FolderHistory, ReleaseStore } from '@/releases';
import type { IReleaseTable } from '@/releases';
import type { IResolvedSource } from '@/sources/common';

/** What a source says about itself, as the release store needs it. */
type TServedSource = Pick<IResolvedSource, 'name' | 'history' | 'project'>;

const CHANGELOG_LAYOUT =
  'atlas reads files named YYYY-MM-DD-<slug>.md from it, each with `packages: [<npm name>, ...]` frontmatter';

/**
 * The one place the release store of a served source is built: the repository store, the store of a cached remote
 * source and the store a refresh swaps in all carry the same facts of the source project (its wiki, its codemod runner,
 * its packages), so a fact added here reaches every path.
 */
export class ServedReleases {
  static storeOf(opts: { source: TServedSource; table: IReleaseTable }): ReleaseStore {
    const { project } = opts.source;

    return new ReleaseStore({
      table: opts.table,
      emptyReason: ServedReleases.emptyReasonOf({ source: opts.source }),
      noEntriesReason: ServedReleases.noEntriesReasonOf({ source: opts.source }),
      codemodCommand: project.knowledge.codemodCommand,
      siteUrl: project.knowledge.siteUrl,
      codemodPackages: project.packages.map((entry) => entry.name),
      folderHistory: new FolderHistory({ project }),
    });
  }

  /** D1: a source fetched without git has no history; anything else has none of the tags it declares. */
  private static emptyReasonOf(opts: { source: TServedSource }): string {
    return opts.source.history === false
      ? `no release history: ${opts.source.name} was fetched without git`
      : `no releases: no tag matches ${opts.source.project.tagPattern} in this ref's history`;
  }

  /** Where a date window looked for dated entries - the directory the manifest declares, or that it declares none. */
  private static noEntriesReasonOf(opts: { source: TServedSource }): string {
    const { root, knowledge } = opts.source.project;

    return knowledge.changelogs === undefined
      ? `no dated changelog entries: the manifest declares no changelog directory - set knowledge.changelogs; ${CHANGELOG_LAYOUT}`
      : `no dated changelog entries in ${relative(root, knowledge.changelogs)} - ${CHANGELOG_LAYOUT}`;
  }
}
