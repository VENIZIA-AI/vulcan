import type { TConstValue } from '../common/index.ts';

/** Why a wiki link is broken: its page does not exist, or the page has no such fragment. */
export class AnchorProblems {
  static readonly MISSING_PAGE = 'missing page';
  static readonly DEAD_ANCHOR = 'dead anchor';
  static readonly SCHEME_SET = new Set<string>([this.MISSING_PAGE, this.DEAD_ANCHOR]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export type TAnchorProblem = TConstValue<typeof AnchorProblems>;

/** The folders and flags of the two wiki gates; a project overrides each with a flag. */
export class WikiDefaults {
  static readonly CONTENT_DIRECTORY = 'docs/wiki/content';
  static readonly DIST_DIRECTORY = 'docs/wiki/site/.vitepress/dist';
  static readonly KNOWLEDGE_DIRECTORY = '.agents/knowledge';
  static readonly CHANGELOG_DIRECTORY = 'docs/wiki/content/changelogs';
}

export class WikiFlags {
  static readonly REPO = '--repo';
  static readonly DIRS = '--dirs';
  static readonly SKIP_PROSE = '--skip-prose';
  static readonly SKIP = '--skip';
  static readonly CONTENT = '--content';
  static readonly DIST = '--dist';
}
