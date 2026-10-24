import { z } from 'zod';
import {
  OwnerConstants,
  OwnerDetails,
  OwnerEnforcement,
  OwnerFormalities,
  OwnerSections,
  OwnerTones,
} from './constants.ts';

const TEXT = z.string().min(1);
const choice = (opts: { isValid: (value: string) => boolean; set: Set<string> }) =>
  z.string().refine((value) => opts.isValid(value), {
    message: `one of: ${[...opts.set].join(', ')}`,
  });

const SECTION = choice({
  isValid: (value) => OwnerSections.isValid(value),
  set: OwnerSections.SCHEME_SET,
});
const ENFORCE = choice({
  isValid: (value) => OwnerEnforcement.isValid(value),
  set: OwnerEnforcement.SCHEME_SET,
});
const TONE = choice({ isValid: (value) => OwnerTones.isValid(value), set: OwnerTones.SCHEME_SET });
const FORMALITY = choice({
  isValid: (value) => OwnerFormalities.isValid(value),
  set: OwnerFormalities.SCHEME_SET,
});
const DETAIL = choice({
  isValid: (value) => OwnerDetails.isValid(value),
  set: OwnerDetails.SCHEME_SET,
});

const DEFAULTS = OwnerConstants.DEFAULT_LABELS;

/** The words of one language: the minimap header, the six statuses and five labels. A closed list. */
export const OWNER_LABEL_SET = z.strictObject({
  minimapColumns: z.tuple([TEXT, TEXT, TEXT]),
  status: z.strictObject({
    done: TEXT,
    doing: TEXT,
    waiting: TEXT,
    todo: TEXT,
    blocked: TEXT,
    dropped: TEXT,
  }),
  labels: z.strictObject({
    blocked: TEXT,
    decisions: TEXT,
    noBlocker: TEXT,
    noDecision: TEXT,
    /** `{x}` is where the recommended answer goes. */
    recommend: TEXT.refine((value) => value.includes('{x}'), { message: 'must contain {x}' }),
  }),
});

/**
 * The project's report contract for answers to its owners: the shape, the status words, the labels and
 * how hard the shape is held. English and `advise` unless the project says otherwise. A person's own
 * language, address and tone live in their profile (`.agents/local/profile.json`), not here.
 */
export const OWNER_SCHEMA = z
  .strictObject({
    language: z.string().min(2).default(OwnerConstants.DEFAULT_LANGUAGE),
    report: z
      .strictObject({
        shape: z.array(SECTION).min(1).default(OwnerConstants.DEFAULT_SHAPE),
        minimapColumns: z.tuple([TEXT, TEXT, TEXT]).default(DEFAULTS.minimapColumns),
        status: OWNER_LABEL_SET.shape.status.default(DEFAULTS.status),
        labels: OWNER_LABEL_SET.shape.labels.default(DEFAULTS.labels),
        headlineMaxSentences: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(OwnerConstants.DEFAULT_HEADLINE_MAX_SENTENCES),
        absolutePaths: z.boolean().default(true),
        enforce: ENFORCE.default(OwnerEnforcement.ADVISE),
      })
      .prefault({}),
  })
  .prefault({});

/** `.agents/local/profile.json`: what one developer told VULCAN about how to work with them. */
export const PROFILE_SCHEMA = z.strictObject({
  schemaVersion: z.literal(OwnerConstants.PROFILE_SCHEMA_VERSION),
  /** Reply language; labels for it come from `labels` below, else English. */
  language: z.string().min(2).optional(),
  address: z
    .strictObject({
      /** How to address the person: a name, a pronoun, an honorific, or nothing. */
      you: z.string().optional(),
      /** How the agent refers to itself. */
      self: z.string().optional(),
      formality: FORMALITY.default(OwnerFormalities.NEUTRAL),
    })
    .prefault({}),
  tone: TONE.default(OwnerTones.NEUTRAL),
  reportDetail: DETAIL.default(OwnerDetails.TABLES),
  habits: z
    .strictObject({
      /** Ask before a reversible choice; false means state a default and continue (V-P-10). */
      askBeforeReversible: z.boolean().default(false),
      proposeCommits: z.boolean().default(false),
    })
    .prefault({}),
  /** In the person's own words, never scored or used to infer traits. */
  about: z.string().max(2000).optional(),
  /** Taste in code that no formatter or lint rule already enforces. */
  codeTaste: z.string().max(1000).optional(),
  /** Stricter than the project's, never looser. */
  enforce: ENFORCE.optional(),
  /** The label set of each language the person uses, keyed by language code. */
  labels: z.record(z.string().min(2), OWNER_LABEL_SET).default({}),
});

export type TOwnerConfig = z.output<typeof OWNER_SCHEMA>;
export type TOwnerLabelSet = z.output<typeof OWNER_LABEL_SET>;
export type TProfile = z.output<typeof PROFILE_SCHEMA>;
