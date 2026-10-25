import { OwnerConstants, OwnerEnforcement, OwnerLabelModes } from './constants.ts';
import type { TOwnerConfig, TOwnerLabelSet, TProfile } from './schema.ts';

/** What one person's replies follow: the project's contract with that person's own settings laid over it. */
export interface IOwnerView {
  language: string;
  /** The words for `language`: the person's own set, the project's when the languages match, else the English set (only used for English). */
  labels: TOwnerLabelSet;
  /** `free` when no label set exists for a language that is not English: the words are the agent's, and only the structure is checked. */
  labelMode: string;
  shape: string[];
  headlineMaxSentences: number;
  absolutePaths: boolean;
  enforce: string;
  /** Replies under this many words are exempt from the shape: the lower of the project's and the person's. */
  shortReplyWords: number;
  /** Words that add to the English ones when a reply is checked for a claim its turn does not back. */
  claimWords: { public: string[]; done: string[] };
  /** Personal settings; absent when the person has no profile. */
  address: { you?: string; self?: string; formality: string } | undefined;
  tone: string | undefined;
  reportDetail: string | undefined;
  habits: { askBeforeReversible: boolean; proposeCommits: boolean } | undefined;
  about: string | undefined;
  codeTaste: string | undefined;
}

/** Whether a language code is English, whatever its region (`en`, `en-GB`). */
export const isEnglishLanguage = (opts: { language: string }): boolean =>
  opts.language.split('-')[0]?.toLowerCase() === OwnerConstants.DEFAULT_LANGUAGE;

const sameLabelSet = (opts: { first: TOwnerLabelSet; second: TOwnerLabelSet }): boolean =>
  JSON.stringify(opts.first) === JSON.stringify(opts.second);

/** The stricter of two enforcement levels. */
export const stricterEnforcement = (opts: {
  first: string;
  second: string | undefined;
}): string => {
  const order: readonly string[] = OwnerEnforcement.STRICTNESS;
  const second = opts.second ?? opts.first;

  return order.indexOf(second) > order.indexOf(opts.first) ? second : opts.first;
};

/**
 * Language, address, tone, detail and habits come from the person's profile; the shape, status set and
 * label defaults from the project block, which a profile may not change; `enforce` is the stricter of
 * the two. A language with no label set of its own gets the English words and, unless it is English,
 * the `free` label mode: the agent writes the labels in the reader's language and the check looks at the
 * structure, never at another language's words.
 */
export const resolveOwnerView = (opts: { owner: TOwnerConfig; profile?: TProfile }): IOwnerView => {
  const { owner, profile } = opts;
  const language = profile?.language ?? owner.language;
  const projectLabels: TOwnerLabelSet = {
    minimapColumns: owner.report.minimapColumns,
    status: owner.report.status,
    labels: owner.report.labels,
  };
  const own =
    profile !== undefined && Object.hasOwn(profile.labels, language)
      ? profile.labels[language]
      : undefined;
  const chosen = own ?? (language === owner.language ? projectLabels : undefined);
  const labels = chosen ?? OwnerConstants.DEFAULT_LABELS;
  const isFree =
    !isEnglishLanguage({ language }) &&
    (chosen === undefined ||
      sameLabelSet({ first: chosen, second: OwnerConstants.DEFAULT_LABELS }));

  return {
    language,
    labels,
    labelMode: isFree ? OwnerLabelModes.FREE : OwnerLabelModes.EXACT,
    shape: owner.report.shape,
    headlineMaxSentences: owner.report.headlineMaxSentences,
    absolutePaths: owner.report.absolutePaths,
    enforce: stricterEnforcement({ first: owner.report.enforce, second: profile?.enforce }),
    claimWords: owner.report.claimWords,
    shortReplyWords: Math.min(
      owner.report.shortReplyWords,
      profile?.shortReplyWords ?? owner.report.shortReplyWords,
    ),
    address: profile?.address,
    tone: profile?.tone,
    reportDetail: profile?.reportDetail,
    habits: profile?.habits,
    about: profile?.about,
    codeTaste: profile?.codeTaste,
  };
};
