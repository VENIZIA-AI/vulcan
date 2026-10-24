import { OwnerConstants, OwnerEnforcement } from './constants.ts';
import type { TOwnerConfig, TOwnerLabelSet, TProfile } from './schema.ts';

/** What one person's replies follow: the project's contract with that person's own settings laid over it. */
export interface IOwnerView {
  language: string;
  /** The words for `language`: the person's own set, the project's when the languages match, else English. */
  labels: TOwnerLabelSet;
  shape: string[];
  headlineMaxSentences: number;
  absolutePaths: boolean;
  enforce: string;
  /** Personal settings; absent when the person has no profile. */
  address: { you?: string; self?: string; formality: string } | undefined;
  tone: string | undefined;
  reportDetail: string | undefined;
  habits: { askBeforeReversible: boolean; proposeCommits: boolean } | undefined;
  about: string | undefined;
  codeTaste: string | undefined;
}

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
 * the two. A language with no label set of its own gets English, never another language's words.
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
  const labels =
    own ?? (language === owner.language ? projectLabels : OwnerConstants.DEFAULT_LABELS);

  return {
    language,
    labels,
    shape: owner.report.shape,
    headlineMaxSentences: owner.report.headlineMaxSentences,
    absolutePaths: owner.report.absolutePaths,
    enforce: stricterEnforcement({ first: owner.report.enforce, second: profile?.enforce }),
    address: profile?.address,
    tone: profile?.tone,
    reportDetail: profile?.reportDetail,
    habits: profile?.habits,
    about: profile?.about,
    codeTaste: profile?.codeTaste,
  };
};
