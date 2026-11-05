import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import { GraphFiles, GraphConstants, GraphStates } from './common/constants';
import { GraphOrder } from './common/order';
import type { IGraphStatus } from './common/types';
import { Fingerprints } from './fingerprints';
import { GitState } from './git-state';
import { GraphMeta } from './graph-meta';

/** Whether the graph still describes the files it was built from. */
export class GraphStatus {
  /**
   * Compares the bytes of the files the last build read with the files now (new, changed or gone), and asks git whether the
   * commit the graph was built at is in the history of HEAD. Never an error: what cannot be asked is `unknown`.
   *  - fresh: nothing the graph was built from has changed.
   *  - behind: files changed since the build, on the same history.
   *  - diverged: files changed and the build commit is not in this history (another branch, a rebase, a reset).
   *  - unknown: no graph, or git cannot be asked.
   */
  static of(opts: { root: string; project: IAtlasProject }): IGraphStatus {
    const meta = GraphMeta.read({ root: opts.root });
    const before = Fingerprints.read({ root: opts.root });

    if (
      meta === undefined ||
      before === undefined ||
      !existsSync(join(opts.root, GraphFiles.DIRECTORY, GraphFiles.CODE))
    ) {
      return {
        state: GraphStates.UNKNOWN,
        reason: 'no graph has been built here: run vulcan x atlas graph build',
      };
    }

    const scope = opts.project.packages
      .filter((item) => !item.retired)
      .map((item) => item.path)
      .sort();
    const files = GitState.trackedFiles({ root: opts.root, paths: scope });
    const head = GitState.commitOf({ root: opts.root });

    if (files === undefined || head === undefined) {
      return {
        state: GraphStates.UNKNOWN,
        reason: 'git cannot be asked (no repository, no commit, or it did not answer)',
        ...(meta.commit === undefined ? {} : { commit: meta.commit }),
        builtAt: meta.builtAt,
      };
    }

    const now = Fingerprints.contentsOf({ root: opts.root, project: opts.project, files });
    const changed = [...new Set([...Object.keys(before.files), ...Object.keys(now)])]
      .filter((path) => before.files[path]?.content !== now[path])
      .sort(GraphOrder.byText);
    const known = {
      head,
      builtAt: meta.builtAt,
      ...(meta.commit === undefined ? {} : { commit: meta.commit }),
    };

    if (changed.length === 0) {
      return { state: GraphStates.FRESH, ...known };
    }

    const isHistory =
      meta.commit !== undefined && GitState.isAncestor({ root: opts.root, ancestor: meta.commit });

    return {
      state: isHistory ? GraphStates.BEHIND : GraphStates.DIVERGED,
      behind: changed.length,
      files: changed.slice(0, GraphConstants.STATUS_FILES_SHOWN),
      ...known,
    };
  }

  /** The status as a person reads it. */
  static describe(opts: { status: IGraphStatus }): string {
    const { status } = opts;
    const named = (status.files ?? []).join(', ');
    const more = (status.behind ?? 0) - (status.files?.length ?? 0);
    const list = more > 0 ? `${named} and ${more} more` : named;

    if (status.state === GraphStates.FRESH) {
      return `graph: fresh - nothing it was built from has changed (built ${status.builtAt ?? ''})`;
    }

    if (status.state === GraphStates.BEHIND) {
      return `graph: behind ${status.behind} - ${list} changed since it was built; run vulcan x atlas graph build`;
    }

    if (status.state === GraphStates.DIVERGED) {
      return `graph: diverged - built at ${status.commit ?? 'an unknown commit'}, which is not in this branch's history, and ${status.behind} files differ (${list}); run vulcan x atlas graph build`;
    }

    return `graph: unknown - ${status.reason ?? 'it cannot be told'}`;
  }
}
