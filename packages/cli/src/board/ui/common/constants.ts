import { BoardConstants } from '../../common/index.ts';

export class BoardLanguages {
  static readonly EN = 'en';
  static readonly VI = 'vi';
}

export class BoardUiConstants {
  /** Names in a flow that are no agent: GitHub's CI and its reviewers. */
  static readonly NOT_AGENTS = new Set<string>([BoardConstants.CI_ACTOR, 'reviewer']);
  /** A line whose `source` says its time was estimated. */
  static readonly APPROXIMATE_SOURCE = /ước lượng/;
  /** The state text of an idle agent already says it. */
  static readonly IDLE_TEXT = /^rảnh/;
  /** The kinds that count as an attempt of their stage: a CI run, a review round, a release. */
  static readonly ATTEMPT_KINDS = new Set<string>(['ci', 'review', 'release']);
}
