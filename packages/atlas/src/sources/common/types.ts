import type { IAtlasProject } from '@/common/project-config';

/** A source a project reads knowledge from: \`atlas.sources\` of its config, or \`--source\`. */
export interface IAtlasSource {
  name: string;
  /** `owner/repo` (GitHub), or a git URL - `file://` in tests. */
  repo: string;
  ref: string;
}

/** How a source was reached this start - the server's instructions say so when it matters. */
export type TSourceMode = 'repository' | 'cache' | 'fresh' | 'offline-cache';

export interface IResolvedSource {
  name: string;
  /** `<repo>@<ref>` for a source reached by git. */
  origin?: string;
  /** The working directory (repo mode), or the cached checkout of `sha`. */
  root: string;
  sha?: string;
  mode: TSourceMode;
  /** The source as its manifest describes it, rooted at `root`. */
  project: IAtlasProject;
  /** The search index built at the pull, for this SHA (git mode only). */
  indexFile?: string;
  /** The release table computed at the pull, for this SHA (git mode only). */
  releasesFile?: string;
  /** Whether releases have history - a source pulled without git has none. */
  history?: boolean;
  /**
   * The npm symbols a start from cache is still asking for, in the background - a registry that
   * stalls never holds up a start. The symbol store finds them once they land.
   */
  symbolsPending?: Promise<void>;
}

/** A source this start could not serve, and why - the server serves the rest and says so. */
export interface IUnavailableSource {
  source: IAtlasSource;
  reason: string;
}

/** What the remote said a ref names: `reachable: false` when it could not be asked, no `sha` when it has no such ref. */
export interface IRemoteRef {
  reachable: boolean;
  sha?: string;
  /** A fingerprint of the remote's tags; absent when the ref was a commit hash and nothing was asked. */
  tags?: string;
}
