import type { IAtlasProject } from '@/common/project-config';
import type { TConstValue, TSourcePin } from '@/common/types';
import type { SourceModes } from './constants';

export type { TSourcePin };

/** A source a project reads knowledge from: \`atlas.sources\` of its config, or \`--source\`. */
export interface IAtlasSource {
  name: string;
  /** `owner/repo` (GitHub), or a git URL - `file://` in tests. */
  repo: string;
  ref: string;
  /**
   * What the corpus (index, wiki, knowledge, changelogs) is read at: `installed` (the default) pins
   * it to the release tag of the newest installed package of the source, `ref` keeps serving `ref`.
   * The release table always comes from `ref`, so an upgrade is still reported.
   */
  pin?: TSourcePin;
}

/** Which ref a source's corpus is at, and why: the server's instructions say so. */
export interface ISourcePin {
  /** The ref the corpus was read at: a release tag when pinned, else the configured ref. */
  ref: string;
  pinned: boolean;
  /** `installed @x/kernel 1.0.0` when pinned; the reason the configured ref is served when not. */
  reason: string;
}

/** How a source was reached this start - the server's instructions say so when it matters. */
export type TSourceMode = TConstValue<typeof SourceModes>;

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
  /** What the project declared for a remote source: how a running server asks again. */
  declared?: IAtlasSource;
  /** Which ref the corpus is at and why; absent for the project itself. */
  pin?: ISourcePin;
  /** The search index built at the pull, for this SHA (git mode only). */
  indexFile?: string;
  /** The release table computed at the pull, for this SHA (git mode only). */
  releasesFile?: string;
  /** Whether releases have history - a source pulled without git has none. */
  history?: boolean;
  /** The cache base this source was resolved into (`.agents/local/cache` by default); remote sources only. */
  cacheBase?: string;
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
