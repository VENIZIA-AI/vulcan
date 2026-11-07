import type { TConstValue } from '@/common/types';
import type {
  ChangeRequestStates,
  CheckStates,
  ProviderTypes,
  ProviderReasons,
  ReviewStates,
} from './constants';

export type TProviderType = TConstValue<typeof ProviderTypes>;
export type TProviderReason = TConstValue<typeof ProviderReasons>;
export type TChangeRequestState = TConstValue<typeof ChangeRequestStates>;
export type TCheckState = TConstValue<typeof CheckStates>;
export type TReviewState = TConstValue<typeof ReviewStates>;

/** A repository on a git host: the host and the path on it (`owner/repo`; GitLab allows `group/sub/repo`). */
export interface IRepositoryRef {
  type: TProviderType;
  host: string;
  path: string;
}

/** Which host the project's own repository lives on: `provider` of the vulcan config. */
export interface IProjectProvider {
  type: TProviderType;
  /** The host name only, without a scheme or a path; the type's own host when absent. */
  host?: string;
}

/** What a provider answers: the value, or why it could not (never a throw). */
export type TProviderResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; reason: TProviderReason; detail?: string };

export interface IPullRequestCheck {
  name: string;
  state: TCheckState;
  /** When the check ended, else when it started; an ISO date. */
  at: string;
  url?: string;
}

export interface IPullRequestReview {
  author: string;
  state: TReviewState;
  at: string;
}

/** A pull request (GitHub) or merge request (GitLab), with its checks and reviews: what the board reads. */
export interface IPullRequest {
  number: number;
  title: string;
  author: string;
  headBranch: string;
  body: string;
  state: TChangeRequestState;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  closedAt?: string;
  checks: IPullRequestCheck[];
  reviews: IPullRequestReview[];
}

/** What a web address of a repository points at. */
export type TWebTarget = { pull: number } | { issue: number } | { blob: string };

/** What the board and the guards ask of a git host. Every operation takes one options object and never throws. */
export interface IGitProvider {
  readonly type: TProviderType;
  /** The repository the working folder is a clone of, as this provider's tool reads it; `undefined` when it cannot tell. */
  currentRepository(opts: { cwd: string }): IRepositoryRef | undefined;
  /** The pull requests of `repo` that changed since `since` (epoch milliseconds), the newest `limit` of them. */
  listPullRequests(opts: {
    repo: IRepositoryRef;
    since: number;
    limit: number;
    cwd: string;
  }): TProviderResult<IPullRequest[]>;
  webUrl(opts: { repo: IRepositoryRef; target: TWebTarget }): string;
}
