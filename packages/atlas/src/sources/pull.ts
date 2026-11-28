import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { AtlasConstants } from '@/common/constants';
import type { IAtlasProject } from '@/common/project-config';
import type { IReleaseTable } from '@/releases/common';
import { ReleaseCompute } from '@/releases/compute';
import { StderrLogger } from '@venizia/vulcan-okf';
import { PrebuiltAttempt } from '@/prebuilt/attempt';
import { SymbolCompute } from '@/symbols/compute';
import { SourceCache } from './cache';
import { CacheSets } from './cache-sets';
import { ChangelogGuard } from './changelog-guard';
import type { IAtlasSource } from './common';
import { SourceSetFiles } from './common';
import { FolderBlobs } from './folder-blobs';
import { GitRepository } from './git';
import { IndexBuild } from './index-build';
import { PullLock } from './lock';
import { GithubTarball } from './tarball';

/**
 * The knowledge paths a manifest declares, from the checkout's root, each once: a path inside another
 * is dropped - tar matches a file against the first pattern only, and would call the inner one empty.
 */
const declaredPathsOf = (opts: { project: IAtlasProject; checkout: string }): string[] => {
  const { bundle, wiki, changelogs } = opts.project.knowledge;
  const paths = [
    '.agents',
    ...[bundle, wiki, changelogs]
      .filter((path): path is string => path !== undefined)
      .map((path) => relative(opts.checkout, path)),
  ];

  return [...new Set(paths)].filter(
    (path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)),
  );
};

/** A file written whole beside its place, then moved in: a reader sees the old one or the new one. */
const writeWhole = (opts: { file: string; text: string }): void => {
  const partial = `${opts.file}.${process.pid}.partial`;

  writeFileSync(partial, opts.text);
  renameSync(partial, opts.file);
};

/** What brings a source's SHA into the cache: a pull by git or by tarball, and what is computed again afterwards. */
export class SourcePull {
  /**
   * What a pull leaves for this SHA: the search index, the release table, the symbols of each
   * package's newest release (D2, from npm - a package npm lacks has none), and `complete`. Built
   * beside its place and moved in last: a reader never sees half of a SHA.
   */
  private static async buildArtifacts(opts: {
    source: IAtlasSource;
    cacheBase: string;
    artifacts: string;
    project: IAtlasProject;
    history: boolean;
    tags?: string;
    /** A pinned tag is read for its docs; the symbols come from what the project installed. */
    corpusOnly?: boolean;
    /** How many dated changelog entries the fetched commit holds in the changelog folder, when git can say. */
    committedEntries?: number;
    /** A verified downloaded index (and, while the tags are unchanged, its release table) in place of building them. */
    prebuilt?: { index: Uint8Array; releases?: IReleaseTable; builtBy: string };
  }): Promise<void> {
    const { project } = opts;
    const partial = `${opts.artifacts}.partial`;

    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });
    writeFileSync(
      join(partial, SourceSetFiles.INDEX),
      opts.prebuilt?.index ?? IndexBuild.indexBytesOf({ project }),
    );

    const releases = opts.prebuilt?.releases ?? ReleaseCompute.compute({ project });

    // Not cached and not served: a table that lost its changelog would answer every window as empty.
    ChangelogGuard.check({
      project,
      releases,
      label: CacheSets.describe({ source: opts.source }),
      committed: opts.committedEntries,
    });

    writeFileSync(join(partial, SourceSetFiles.RELEASES), `${JSON.stringify(releases)}\n`);

    if (opts.corpusOnly !== true) {
      await SourcePull.fetchPublishedSymbols({
        source: opts.source,
        project,
        releases,
        cacheBase: opts.cacheBase,
      });
    }

    if (opts.history) {
      writeFileSync(join(partial, SourceSetFiles.HISTORY), '');
    }

    if (opts.tags !== undefined) {
      writeFileSync(join(partial, SourceSetFiles.TAGS), `${opts.tags}\n`);
    }

    if (opts.prebuilt !== undefined) {
      writeFileSync(join(partial, SourceSetFiles.PREBUILT), `${opts.prebuilt.builtBy}\n`);
    }

    writeFileSync(join(partial, SourceSetFiles.FORMAT), `${AtlasConstants.INDEX_FORMAT}\n`);
    writeFileSync(join(partial, SourceSetFiles.COMPLETE), `${new Date().toISOString()}\n`);
    rmSync(opts.artifacts, { recursive: true, force: true });
    renameSync(partial, opts.artifacts);
  }

  /**
   * The symbols of each live package's newest release (D2, from npm), for those not cached yet. A
   * package npm lacks (a private one) or a registry that is down is logged; the absent cache entry is
   * the record of it, so the next start asks npm again.
   */
  static async fetchPublishedSymbols(opts: {
    source: IAtlasSource;
    project: IAtlasProject;
    releases: IReleaseTable;
    cacheBase: string;
  }): Promise<void> {
    for (const entry of opts.project.packages.filter((item) => !item.retired)) {
      const version = opts.releases.releases[entry.dir]?.[0]?.version;

      if (version === undefined) {
        continue;
      }

      try {
        await SymbolCompute.symbolsOfPublished({
          name: entry.name,
          version,
          cacheBase: opts.cacheBase,
        });
      } catch (error) {
        StderrLogger.get('fetchPublishedSymbols').warn(
          `no symbols for ${entry.name}@${version} yet, the next start asks npm again | source: ${opts.source.name} | error: %s`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /** A pull by git: the partial clone brought up to date, a sparse checkout - the manifest first, then its paths. */
  static async pullByGit(opts: {
    source: IAtlasSource;
    cacheBase: string;
    cacheRoot: string;
    sha: string;
    tags?: string;
    corpusOnly?: boolean;
    /** Whether a prebuilt index may be downloaded, and the keys that must have signed it. */
    prebuilt?: { enabled: boolean; keys?: string[] };
  }): Promise<void> {
    const gitDir = CacheSets.gitDirOf(opts);
    const checkout = SourceCache.checkoutOf(opts);

    GitRepository.updateClone({ url: SourceCache.urlOf(opts.source), gitDir, sha: opts.sha });
    GitRepository.run({ cwd: gitDir, args: ['worktree', 'prune'] });
    GitRepository.sparseCheckout({
      gitDir,
      directory: checkout,
      sha: opts.sha,
      paths: ['.agents'],
    });

    const project = CacheSets.projectOf({ checkout, source: opts.source });
    const hit = await PrebuiltAttempt.attempt({
      enabled: opts.prebuilt?.enabled ?? false,
      source: opts.source,
      sha: opts.sha,
      keys: opts.prebuilt?.keys ?? project.indexKeys ?? [],
    });
    // The release table of a pair is the one its tags made: valid only while the remote's tags are the same.
    const releases =
      hit !== undefined &&
      hit.payload.history &&
      opts.tags !== undefined &&
      hit.payload.tags === opts.tags
        ? hit.payload.releases
        : undefined;

    const changelogs = project.knowledge.changelogs;

    // `migrate` reads the version folders at a package's tags with git told never to fetch: their blobs come now.
    FolderBlobs.prefetch({
      project,
      gitDir,
      url: SourceCache.urlOf(opts.source),
      sha: opts.sha,
    });

    // A local build reads every declared path; a downloaded index needs the changelogs alone, to compute
    // the release table here, and nothing at all when the pair's table is still current - but the version folders,
    // which `migrate` reads from disk.
    GitRepository.setSparsePaths({
      directory: checkout,
      paths:
        hit === undefined
          ? declaredPathsOf({ project, checkout })
          : [
              '.agents',
              ...(releases !== undefined || changelogs === undefined
                ? []
                : [relative(checkout, changelogs)]),
              ...(changelogs === undefined
                ? []
                : FolderBlobs.directoriesAt({
                    gitDir,
                    sha: opts.sha,
                    folder: relative(checkout, changelogs),
                  })),
            ],
    });
    await SourcePull.buildArtifacts({
      source: opts.source,
      cacheBase: opts.cacheBase,
      artifacts: SourceCache.artifactsOf(opts),
      project,
      history: true,
      tags: opts.tags,
      committedEntries: CacheSets.committedEntriesOf({ checkout, project }),
      corpusOnly: opts.corpusOnly,
      ...(hit === undefined
        ? {}
        : { prebuilt: { index: hit.index, releases, builtBy: hit.payload.atlas } }),
    });
  }

  /**
   * A release tag pushed after its commit was pulled: the clone fetches the tags and the release table
   * is computed again - the corpus is not pulled again. A failure keeps the table the pull computed.
   */
  static async refreshReleases(opts: {
    source: IAtlasSource;
    cacheRoot: string;
    sha: string;
    tags?: string;
  }): Promise<void> {
    const artifacts = SourceCache.artifactsOf(opts);
    const tagsFile = join(artifacts, SourceSetFiles.TAGS);
    const isCurrent = (): boolean =>
      opts.tags === undefined ||
      !existsSync(join(artifacts, SourceSetFiles.HISTORY)) ||
      (existsSync(tagsFile) && readFileSync(tagsFile, 'utf8').trim() === opts.tags);

    if (isCurrent()) {
      return;
    }

    try {
      await PullLock.with({
        cacheRoot: opts.cacheRoot,
        label: CacheSets.describe(opts),
        run: () => {
          // Another start computed them while this one waited for the lock.
          if (!isCurrent()) {
            GitRepository.updateClone({
              url: SourceCache.urlOf(opts.source),
              gitDir: CacheSets.gitDirOf(opts),
            });

            const project = CacheSets.projectOf({
              checkout: SourceCache.checkoutOf(opts),
              source: opts.source,
            });

            writeWhole({
              file: join(artifacts, SourceSetFiles.RELEASES),
              text: `${JSON.stringify(ReleaseCompute.compute({ project }))}\n`,
            });
            writeWhole({ file: tagsFile, text: `${opts.tags}\n` });
          }

          return Promise.resolve();
        },
      });
    } catch (error) {
      StderrLogger.get('refreshReleases').warn(
        `kept the releases the pull computed | source: ${opts.source.name} | error: %s`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** A pull with no git on the machine: the tarball of the SHA, the manifest first, then its paths. No history. */
  static async pullByTarball(opts: {
    source: IAtlasSource;
    cacheBase: string;
    cacheRoot: string;
    sha: string;
    github: { owner: string; repo: string };
    token?: string;
    corpusOnly?: boolean;
  }): Promise<void> {
    const checkout = SourceCache.checkoutOf(opts);
    const scratch = join(opts.cacheBase, 'tmp');

    mkdirSync(scratch, { recursive: true });

    const work = mkdtempSync(join(scratch, 'atlas-source-tarball-'));

    try {
      const archive = await GithubTarball.download({
        ...opts.github,
        sha: opts.sha,
        token: opts.token,
        work,
      });

      GithubTarball.extract({ archive, directory: checkout, paths: ['.agents'] });

      const project = CacheSets.projectOf({ checkout, source: opts.source });

      GithubTarball.extract({
        archive,
        directory: checkout,
        paths: declaredPathsOf({ project, checkout }),
      });
      await SourcePull.buildArtifacts({
        source: opts.source,
        cacheBase: opts.cacheBase,
        artifacts: SourceCache.artifactsOf(opts),
        project,
        history: false,
        corpusOnly: opts.corpusOnly,
      });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}
