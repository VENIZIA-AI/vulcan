import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { MANIFEST_FILE, ProjectConfig } from '@/common/project-config';
import { AtlasConstants } from '@/common/constants';
import { VulcanError } from '@venizia/vulcan-okf';
import { StderrLogger } from '@venizia/vulcan-okf';
import type { IAtlasProject } from '@/common/project-config';
import type { IReleaseTable } from '@/releases/common';
import { SourceCache } from './cache';
import { ChangelogGuard } from './changelog-guard';
import type { IAtlasSource, IResolvedSource, TSourceMode } from './common';
import { SourceSetFiles } from './common';
import { GitRepository } from './git';

/** A source's newest SHAs the cache keeps - each one a checkout and an index - so it never grows unbounded. */
const KEPT_SHAS = 3;
/** The `refs/ref-*` files the cache keeps, the newest served first: each one holds a SHA out of pruning. */
const KEPT_REFS = 5;
/** `refs/ref-<ref>` holds the SHA last served for that ref: an offline start stays on its ref. */
const REFS = 'refs';

// The prefix keeps a ref of `.` or `..` a plain file name; encoding leaves no `/` in it.
const refFileOf = (opts: { cacheRoot: string; ref: string }): string =>
  join(opts.cacheRoot, REFS, `ref-${encodeURIComponent(opts.ref)}`);

/** Written beside its place and moved in: a start racing this one reads one SHA or the other. */
const recordRef = (opts: { cacheRoot: string; ref: string; sha: string }): void => {
  const file = refFileOf(opts);
  const partial = join(opts.cacheRoot, REFS, `partial-${process.pid}-${randomUUID()}`);

  mkdirSync(join(opts.cacheRoot, REFS), { recursive: true });
  writeFileSync(partial, `${opts.sha}\n`);
  renameSync(partial, file);
};

/** Every SHA a ref was last served at - pruning keeps them, so each ref keeps its offline fallback. */
const recordedShas = (opts: { cacheRoot: string }): Set<string> => {
  const directory = join(opts.cacheRoot, REFS);

  if (!existsSync(directory)) {
    return new Set();
  }

  return new Set(
    readdirSync(directory)
      .filter((name) => name.startsWith('ref-'))
      .map((name) => readFileSync(join(directory, name), 'utf8').trim()),
  );
};

/**
 * A ref that was pinned once and never served again lets its SHA go: only the newest `KEPT_REFS` stay, and the SHAs
 * of the ones that left are pruned by the next pull.
 */
const pruneOlderRefs = (opts: { cacheRoot: string }): void => {
  const directory = join(opts.cacheRoot, REFS);

  if (!existsSync(directory)) {
    return;
  }

  const refs = readdirSync(directory)
    .filter((name) => name.startsWith('ref-'))
    .map((name) => ({ name, at: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.at - left.at);

  for (const ref of refs.slice(KEPT_REFS)) {
    rmSync(join(directory, ref.name), { force: true });
  }
};

/** The atlas version that built the index, when the set came from a prebuilt pair. */
const prebuiltByOf = (opts: { artifacts: string }): { prebuiltBy?: string } => {
  const file = join(opts.artifacts, SourceSetFiles.PREBUILT);

  return existsSync(file) ? { prebuiltBy: readFileSync(file, 'utf8').trim() } : {};
};

/** The set's `format` file names this atlas's `INDEX_FORMAT`; a set without the file, or with another number, is not current. */
const isCurrentFormat = (opts: { cacheRoot: string; sha: string }): boolean => {
  const file = join(SourceCache.artifactsOf(opts), SourceSetFiles.FORMAT);

  return (
    existsSync(file) && readFileSync(file, 'utf8').trim() === String(AtlasConstants.INDEX_FORMAT)
  );
};

/** A pull finished for this SHA, at whatever format: what the cache keeps and prunes. */
const isComplete = (opts: { cacheRoot: string; sha: string }): boolean =>
  existsSync(join(SourceCache.artifactsOf(opts), SourceSetFiles.COMPLETE)) &&
  existsSync(SourceCache.checkoutOf(opts));

/** Every SHA pulled completely, the most recent pull first. */
const completeShas = (opts: { cacheRoot: string }): string[] => {
  if (!existsSync(opts.cacheRoot)) {
    return [];
  }

  return readdirSync(opts.cacheRoot)
    .filter((name) => name.endsWith('.atlas'))
    .map((name) => name.slice(0, -'.atlas'.length))
    .filter((sha) => isComplete({ cacheRoot: opts.cacheRoot, sha }))
    .map((sha) => ({
      sha,
      at: statSync(
        join(SourceCache.artifactsOf({ cacheRoot: opts.cacheRoot, sha }), SourceSetFiles.COMPLETE),
      ).mtimeMs,
    }))
    .sort((left, right) => right.at - left.at)
    .map((entry) => entry.sha);
};

/** The cached SHA sets of a source: which are complete and current, what is served from one, which are pruned. */
export class CacheSets {
  /**
   * A set whose release table holds no changelog entry although its commit holds some: a table that lost them
   * (a checkout that did not show the folder when it was built). It is not served: the next start pulls it again.
   */
  private static hasLostChangelogs(opts: { cacheRoot: string; sha: string }): boolean {
    try {
      const table: IReleaseTable = JSON.parse(
        readFileSync(join(SourceCache.artifactsOf(opts), SourceSetFiles.RELEASES), 'utf8'),
      );

      // A folder whose log holds no item is a changelog too: it yields no record, and the table names it.
      if (table.changelogs.length > 0 || (table.versionFolders?.length ?? 0) > 0) {
        return false;
      }

      const checkout = SourceCache.checkoutOf(opts);
      const project = ProjectConfig.toAtlasProject({
        root: checkout,
        manifest: JSON.parse(
          readFileSync(
            ProjectConfig.manifestFileOf({ dir: checkout }) ?? join(checkout, MANIFEST_FILE),
            'utf8',
          ),
        ),
      });

      return (CacheSets.committedEntriesOf({ checkout, project }) ?? 0) > 0;
    } catch (error) {
      StderrLogger.get('CacheSets.hasLostChangelogs').debug(
        'a set that cannot be read for this check | error: %s',
        error,
      );

      // A set that cannot be read for this check is judged as it was before: by being complete and current.
      return false;
    }
  }

  static gitDirOf(opts: { cacheRoot: string }): string {
    return join(opts.cacheRoot, 'git');
  }

  static describe(opts: { source: IAtlasSource }): string {
    return `source '${opts.source.name}' (${opts.source.repo}@${opts.source.ref})`;
  }

  /** The source as its manifest describes it - data, never its config: a fetched repository's code never runs. */
  static projectOf(opts: { checkout: string; source: IAtlasSource }): IAtlasProject {
    const file = ProjectConfig.manifestFileOf({ dir: opts.checkout });

    if (file === undefined) {
      throw VulcanError.of({
        message: `atlas: ${CacheSets.describe(opts)} has no ${MANIFEST_FILE} - its maintainers run \`vulcan project sync\` and commit it`,
      });
    }

    return ProjectConfig.toAtlasProject({
      root: opts.checkout,
      manifest: JSON.parse(readFileSync(file, 'utf8')),
      source: CacheSets.describe(opts),
    });
  }

  static servedFrom(opts: {
    source: IAtlasSource;
    cacheBase: string;
    cacheRoot: string;
    sha: string;
    mode: TSourceMode;
  }): IResolvedSource {
    const checkout = SourceCache.checkoutOf(opts);
    const artifacts = SourceCache.artifactsOf(opts);

    if (opts.mode !== 'offline-cache') {
      recordRef({ cacheRoot: opts.cacheRoot, ref: opts.source.ref, sha: opts.sha });
      pruneOlderRefs({ cacheRoot: opts.cacheRoot });
    }

    return {
      name: opts.source.name,
      declared: opts.source,
      origin: `${opts.source.repo}@${opts.source.ref}`,
      root: checkout,
      sha: opts.sha,
      mode: opts.mode,
      project: CacheSets.projectOf({ checkout, source: opts.source }),
      indexFile: join(artifacts, SourceSetFiles.INDEX),
      releasesFile: join(artifacts, SourceSetFiles.RELEASES),
      history: existsSync(join(artifacts, SourceSetFiles.HISTORY)),
      ...prebuiltByOf({ artifacts }),
      cacheBase: opts.cacheBase,
    };
  }

  /** The dated entries the fetched commit holds in the changelog folder: what the checkout must show, whatever the sparse paths did. */
  static committedEntriesOf(opts: {
    checkout: string;
    project: IAtlasProject;
  }): number | undefined {
    const directory = opts.project.knowledge.changelogs;

    if (directory === undefined) {
      return undefined;
    }

    const listed = GitRepository.run({
      cwd: opts.checkout,
      args: ['ls-tree', '--name-only', 'HEAD', '--', `${relative(opts.checkout, directory)}/`],
    });

    return ChangelogGuard.datedIn({
      names: listed.split('\n').filter((line) => line.length > 0),
      holdsLog: ({ folder }) =>
        GitRepository.run({
          cwd: opts.checkout,
          args: ['ls-tree', '--name-only', 'HEAD', '--', `${folder}/log.md`],
        }).trim().length > 0,
    });
  }

  /** A complete set built at this atlas's format: the only kind a start serves, online without pulling, offline from the cache. */
  static isCurrentSet(opts: { cacheRoot: string; sha: string }): boolean {
    return isComplete(opts) && isCurrentFormat(opts) && !CacheSets.hasLostChangelogs(opts);
  }

  /** The SHA last served for `ref`, for an offline start - never another ref's. */
  static lastServedFor(opts: { cacheRoot: string; ref: string }): string | undefined {
    const file = refFileOf(opts);
    const sha = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';

    return GitRepository.isCommitSha({ ref: sha, isFull: true }) &&
      CacheSets.isCurrentSet({ cacheRoot: opts.cacheRoot, sha })
      ? sha
      : undefined;
  }

  /**
   * All but the newest `KEPT_SHAS` complete SHAs leave the cache - never the one being served, nor
   * one a ref was last served at.
   */
  static pruneOlderShas(opts: { cacheRoot: string; served: string }): void {
    const recorded = recordedShas(opts);
    const older = completeShas(opts)
      .filter((sha) => sha !== opts.served)
      .slice(KEPT_SHAS - 1)
      .filter((sha) => !recorded.has(sha));

    for (const sha of older) {
      rmSync(SourceCache.checkoutOf({ cacheRoot: opts.cacheRoot, sha }), {
        recursive: true,
        force: true,
      });
      rmSync(SourceCache.artifactsOf({ cacheRoot: opts.cacheRoot, sha }), {
        recursive: true,
        force: true,
      });
    }

    // The clone forgets the worktrees whose directories are gone.
    if (older.length > 0 && GitRepository.hasClone({ gitDir: CacheSets.gitDirOf(opts) })) {
      GitRepository.run({ cwd: CacheSets.gitDirOf(opts), args: ['worktree', 'prune'] });
    }
  }
}
