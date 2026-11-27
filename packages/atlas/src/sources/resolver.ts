import { readFileSync, rmSync } from 'node:fs';
import { ProjectConfig } from '@/common/project-config';
import { SourcePins } from '@/common/constants';
import { VulcanError } from '@venizia/vulcan-okf';
import { SourceCache } from './cache';
import { CacheSets } from './cache-sets';
import type { IAtlasSource, IRemoteRef, IResolvedSource, IUnavailableSource } from './common';
import { SourceModes } from './common';
import { GithubCredentials } from './credentials';
import { GitRepository } from './git';
import { PullLock } from './lock';
import { InstalledPackages } from './installed';
import { PinPolicy } from './pin';
import { SourcePull } from './pull';
import { GithubTarball } from './tarball';

/**
 * The commit the source's ref names now. A commit hash is one already - a short one is expanded
 * from the clone, fetched first when the clone lacks it; a branch or a tag is what the remote
 * advertises, by git or, without it, over HTTP.
 */
const lookUpRef = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  byGit: boolean;
  github?: { owner: string; repo: string };
  token?: string;
}): Promise<IRemoteRef> => {
  const { ref } = opts.source;
  const gitDir = CacheSets.gitDirOf(opts);

  if (GitRepository.isCommitSha({ ref, isFull: true })) {
    return { reachable: true, sha: ref };
  }

  if (!GitRepository.isCommitSha({ ref })) {
    return opts.byGit || opts.github === undefined
      ? GitRepository.lsRemote({ url: SourceCache.urlOf(opts.source), ref })
      : GithubTarball.lsRemoteByHttp({ ...opts.github, ref, token: opts.token });
  }

  if (!opts.byGit) {
    throw VulcanError.of({
      message: `atlas: ${CacheSets.describe(opts)} - a short commit hash needs git on this machine; give all 40 characters`,
    });
  }

  const known = GitRepository.hasClone({ gitDir })
    ? GitRepository.commitOf({ gitDir, ref })
    : undefined;

  if (known !== undefined) {
    return { reachable: true, sha: known };
  }

  return PullLock.with({
    cacheRoot: opts.cacheRoot,
    label: CacheSets.describe(opts),
    run: () => {
      GitRepository.updateClone({ url: SourceCache.urlOf(opts.source), gitDir });

      return Promise.resolve({ reachable: true, sha: GitRepository.commitOf({ gitDir, ref }) });
    },
  });
};

/**
 * A source: the cache for the SHA the ref names now, a pull when it moved, the newest cache when the
 * remote is unreachable. Without git, a GitHub `owner/repo` source comes by tarball, its SHA from the
 * ref advertisement; the token (`GITHUB_TOKEN`, else `gh auth token`) rides only in request headers.
 */
const resolveRemote = async (opts: {
  source: IAtlasSource;
  cacheBase: string;
  force: boolean;
  /** Only the corpus is wanted (a pinned tag): the release table and the npm symbols are another ref's job. */
  corpusOnly?: boolean;
  /** Whether a prebuilt index may be downloaded (default yes), and the keys the ref's manifest lists when this is a pinned tag. */
  prebuilt?: boolean;
  indexKeys?: string[];
}): Promise<IResolvedSource> => {
  const refused = GitRepository.refusedTransportOf({ repo: opts.source.repo });

  if (refused !== undefined) {
    throw VulcanError.of({
      message: `atlas: ${CacheSets.describe(opts)} uses ${refused} - use https or ssh`,
    });
  }

  const cacheRoot = SourceCache.cacheRootOf({ repo: opts.source.repo, cacheBase: opts.cacheBase });
  const byGit = GithubTarball.hasGit();
  const github = GithubTarball.githubRepoOf(opts.source);

  if (!byGit && github === undefined) {
    throw VulcanError.of({
      message: `atlas: ${CacheSets.describe(opts)} needs git on this machine - only an owner/repo source has a tarball path`,
    });
  }

  const token = byGit ? undefined : GithubCredentials.tokenOf();
  const remote = await lookUpRef({ source: opts.source, cacheRoot, byGit, github, token });

  if (!remote.reachable) {
    const cached = CacheSets.lastServedFor({ cacheRoot, ref: opts.source.ref });

    if (cached === undefined) {
      throw VulcanError.of({
        message: `atlas: ${CacheSets.describe(opts)} is unreachable and has no cache`,
      });
    }

    return CacheSets.servedFrom({
      source: opts.source,
      cacheBase: opts.cacheBase,
      cacheRoot,
      sha: cached,
      mode: SourceModes.OFFLINE_CACHE,
    });
  }

  const { sha } = remote;

  // The remote answered: a ref it does not have is a mistake to report, never a reason to go offline.
  if (sha === undefined) {
    throw VulcanError.of({
      message: `atlas: ${CacheSets.describe(opts)} - the remote has no ${GitRepository.isCommitSha({ ref: opts.source.ref }) ? 'commit' : 'branch or tag'} '${opts.source.ref}'`,
    });
  }

  if (!opts.force && CacheSets.isCurrentSet({ cacheRoot, sha })) {
    const served = CacheSets.servedFrom({
      source: opts.source,
      cacheBase: opts.cacheBase,
      cacheRoot,
      sha,
      mode: SourceModes.CACHE,
    });

    if (opts.corpusOnly === true) {
      return served;
    }

    await SourcePull.refreshReleases({ source: opts.source, cacheRoot, sha, tags: remote.tags });

    // What npm could not give at the pull, asked again in the background: `complete` never stops
    // the retry, and a registry that stalls never holds up the start.
    const symbolsPending = SourcePull.fetchPublishedSymbols({
      source: opts.source,
      project: served.project,
      releases: JSON.parse(readFileSync(served.releasesFile ?? '', 'utf8')),
      cacheBase: opts.cacheBase,
    });

    return { ...served, symbolsPending };
  }

  return PullLock.with({
    cacheRoot,
    label: CacheSets.describe(opts),
    run: async () => {
      // Another start pulled it while this one waited for the lock.
      if (!opts.force && CacheSets.isCurrentSet({ cacheRoot, sha })) {
        return CacheSets.servedFrom({
          source: opts.source,
          cacheBase: opts.cacheBase,
          cacheRoot,
          sha,
          mode: SourceModes.CACHE,
        });
      }

      // A pull interrupted before it finished left a checkout behind: start that SHA over.
      rmSync(SourceCache.checkoutOf({ cacheRoot, sha }), { recursive: true, force: true });

      if (byGit) {
        await SourcePull.pullByGit({
          source: opts.source,
          cacheBase: opts.cacheBase,
          cacheRoot,
          sha,
          tags: remote.tags,
          corpusOnly: opts.corpusOnly,
          prebuilt: {
            enabled: opts.prebuilt !== false,
            keys: opts.indexKeys,
          },
        });
      } else if (github !== undefined) {
        await SourcePull.pullByTarball({
          source: opts.source,
          cacheBase: opts.cacheBase,
          cacheRoot,
          sha,
          github,
          token,
          corpusOnly: opts.corpusOnly,
        });
      }

      CacheSets.pruneOlderShas({ cacheRoot, served: sha });

      return CacheSets.servedFrom({
        source: opts.source,
        cacheBase: opts.cacheBase,
        cacheRoot,
        sha,
        mode: SourceModes.FRESH,
      });
    },
  });
};

/**
 * A remote source as the project runs it. The ref is resolved first: its manifest and release table
 * say which release the installed packages are. The corpus is then read at that release's tag; the
 * release table stays the ref's, so `version` and `changes` still know the newer releases. When nothing
 * can be pinned the ref is served and `pin.reason` says why.
 */
const resolveAtInstalled = async (opts: {
  source: IAtlasSource;
  cwd: string;
  cacheBase: string;
  force: boolean;
  prebuilt?: boolean;
}): Promise<IResolvedSource> => {
  const base = await resolveRemote({
    source: opts.source,
    cacheBase: opts.cacheBase,
    force: opts.force,
    prebuilt: opts.prebuilt,
  });
  const atRef = (reason: string): IResolvedSource => ({
    ...base,
    pin: { ref: opts.source.ref, pinned: false, reason },
  });

  if (opts.source.pin === SourcePins.REF) {
    return atRef('pin is ref');
  }

  if (base.releasesFile === undefined) {
    return atRef('no release table to read the installed version from');
  }

  const decision = PinPolicy.decide({
    roots: InstalledPackages.installRootsOf({ cwd: opts.cwd }),
    project: base.project,
    table: JSON.parse(readFileSync(base.releasesFile, 'utf8')),
  });

  if (!decision.pinned) {
    return atRef(decision.reason);
  }

  try {
    const at = await resolveRemote({
      source: { ...opts.source, ref: decision.tag },
      cacheBase: opts.cacheBase,
      force: opts.force,
      corpusOnly: true,
      prebuilt: opts.prebuilt,
      // The keys are the ref's: a tag older than the keys has none of its own, and one signed by a key since removed is refused.
      indexKeys: base.project.indexKeys ?? [],
    });

    return {
      ...at,
      declared: opts.source,
      releasesFile: base.releasesFile,
      history: base.history,
      refProject: base.project,
      pin: { ref: decision.tag, pinned: true, reason: decision.basis },
    };
  } catch (error) {
    return atRef(
      `could not read ${decision.tag}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Every source atlas serves: the working directory when it has a manifest (repo mode, no git), then
 * each declared source, from the cache or a pull (Project Contract v1, spec section 3).
 */
const resolveSelf = (opts: { cwd: string }): IResolvedSource[] =>
  ProjectConfig.hasAtlasProject({ root: opts.cwd })
    ? [
        (() => {
          const project = ProjectConfig.readAtlasProject({ root: opts.cwd });

          return { name: project.name, root: opts.cwd, mode: SourceModes.REPOSITORY, project };
        })(),
      ]
    : [];

export class SourceResolver {
  /** Whether the cache holds a complete set of this atlas's format for `sha` of the source: what a start serves without asking the remote. */
  static isCached(opts: { source: IAtlasSource; cacheBase: string; sha: string }): boolean {
    return CacheSets.isCurrentSet({
      cacheRoot: SourceCache.cacheRootOf({ repo: opts.source.repo, cacheBase: opts.cacheBase }),
      sha: opts.sha,
    });
  }

  /** One remote source resolved again, as a start does: the cache for the SHA its ref names now, a pull when it moved. */
  static resolveRemote(opts: {
    source: IAtlasSource;
    cwd: string;
    cacheDir?: string;
    prebuilt?: boolean;
  }): Promise<IResolvedSource> {
    return resolveAtInstalled({
      source: opts.source,
      cwd: opts.cwd,
      cacheBase: SourceCache.cacheBaseOf(opts),
      force: false,
      prebuilt: opts.prebuilt,
    });
  }

  /** The project at `cwd` and every source; one that cannot be resolved throws (`pull` reports it). */
  static async resolve(opts: {
    cwd: string;
    sources: IAtlasSource[];
    cacheDir?: string;
    force?: boolean;
    prebuilt?: boolean;
  }): Promise<IResolvedSource[]> {
    const remote: IResolvedSource[] = [];
    const cacheBase = SourceCache.cacheBaseOf(opts);

    for (const source of opts.sources) {
      const result = await resolveAtInstalled({
        source,
        cwd: opts.cwd,
        cacheBase,
        force: opts.force ?? false,
        prebuilt: opts.prebuilt,
      });
      remote.push(result);
    }

    return [...resolveSelf(opts), ...remote];
  }

  /**
   * What `mcp` serves: the project and every source it can reach. A source that cannot be served - no
   * committed manifest yet, a ref that broke, a host that is down with nothing cached - is set aside
   * with its reason; it never takes the project or the other sources down with it.
   */
  static async resolveServable(opts: {
    cwd: string;
    sources: IAtlasSource[];
    cacheDir?: string;
    prebuilt?: boolean;
  }): Promise<{ resolved: IResolvedSource[]; unavailable: IUnavailableSource[] }> {
    const remote: IResolvedSource[] = [];
    const unavailable: IUnavailableSource[] = [];
    const cacheBase = SourceCache.cacheBaseOf(opts);

    for (const source of opts.sources) {
      try {
        const result = await resolveAtInstalled({
          source,
          cwd: opts.cwd,
          cacheBase,
          force: false,
          prebuilt: opts.prebuilt,
        });
        remote.push(result);
      } catch (error) {
        unavailable.push({
          source,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { resolved: [...resolveSelf(opts), ...remote], unavailable };
  }
}
