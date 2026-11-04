/** The languages of the page. */
export class BoardLanguages {
  static readonly EN = 'en';
  static readonly VI = 'vi';
  static readonly SCHEME_SET = new Set<string>([this.EN, this.VI]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class BoardUiConstants {
  /** Names that appear in a flow but are no agent: the CI of GitHub and its reviewers. */
  static readonly NOT_AGENTS = new Set<string>(['CI', 'reviewer']);
  /** An event whose `source` says its time was estimated. */
  static readonly APPROXIMATE_SOURCE = /ước lượng/;
  /** The state text of an idle agent already says it. */
  static readonly IDLE_TEXT = /^rảnh/;
  /** The ranking of an agent state when a lane merges the states of its helpers. */
  static readonly STATE_RANK: Record<string, number> = { working: 2, idle: 1 };
  /** The attempt-bearing kinds of a flow: a CI run, a review round, a release. */
  static readonly ATTEMPT_KINDS = new Set<string>(['ci', 'review', 'release']);
}
