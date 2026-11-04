import { z } from 'zod';
import {
  OwnerConstants,
  OwnerDetails,
  OwnerEnforcement,
  OwnerFormalities,
  OwnerSections,
  OwnerTones,
} from './constants.ts';

const TEXT = z.string().regex(OwnerConstants.LABEL_PATTERN, {
  message: 'one line of at most 80 characters, with no backtick, pipe or quote',
});
const LANGUAGE = z.string().regex(OwnerConstants.LANGUAGE_PATTERN, {
  message: 'a language code such as en or pt-BR',
});
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

/** A phrase, not a stray letter pair: at least three characters, one of them not a space. */
const CLAIM_WORDS = z
  .array(
    z
      .string()
      .max(60)
      .regex(/^(?=.*\S).{3,}$/u),
  )
  .max(20);
const SHORT_REPLY_WORDS = z.number().int().min(0).max(OwnerConstants.MAX_SHORT_REPLY_WORDS);

const DEFAULTS = OwnerConstants.DEFAULT_LABELS;

/** The words of one language: the minimap header, the six statuses and five labels. A closed list. */
export const OWNER_LABEL_SET = z.strictObject({
  /** Three column headers of the minimap table, in order; each one line of at most 80 characters. */
  minimapColumns: z.tuple([TEXT, TEXT, TEXT]),
  /** Words for the six task statuses of the minimap. */
  status: z.strictObject({
    /** Status word for finished work. */
    done: TEXT,
    /** Status word for work under way. */
    doing: TEXT,
    /** Status word for work waiting on someone. */
    waiting: TEXT,
    /** Status word for work not yet started. */
    todo: TEXT,
    /** Status word for work that cannot go on. */
    blocked: TEXT,
    /** Status word for work that was dropped. */
    dropped: TEXT,
  }),
  /** Labels for the blocked and decisions parts of a reply. */
  labels: z.strictObject({
    /** Label that opens the blocked line of a reply. */
    blocked: TEXT,
    /** Heading of the decisions part of a reply. */
    decisions: TEXT,
    /** Text shown in the blocked line when nothing blocks. */
    noBlocker: TEXT,
    /** Text shown in the decisions part when no decision is needed. */
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
    /** Language of the reply labels, a code such as `en` or `pt-BR`; default `en`. */
    language: LANGUAGE.default(OwnerConstants.DEFAULT_LANGUAGE),
    report: z
      .strictObject({
        /** Sections of a reply, in order: headline, minimap, blocked, detail, decisions; at least one, default all five in that order. */
        shape: z.array(SECTION).min(1).default(OwnerConstants.DEFAULT_SHAPE),
        /** Three minimap column headers; default `#`, `Task`, `Status`. */
        minimapColumns: z.tuple([TEXT, TEXT, TEXT]).default(DEFAULTS.minimapColumns),
        /** Status words of the minimap; default the English set (done, in progress, waiting, not started, blocked, dropped). */
        status: OWNER_LABEL_SET.shape.status.default(DEFAULTS.status),
        /** Labels of the blocked and decisions parts; default the English set. */
        labels: OWNER_LABEL_SET.shape.labels.default(DEFAULTS.labels),
        headlineMaxSentences: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(OwnerConstants.DEFAULT_HEADLINE_MAX_SENTENCES),
        /** Whether file paths in a reply must be absolute; default `true`. */
        absolutePaths: z.boolean().default(true),
        /** How hard the reply shape is held: `off`, `advise` or `block`; default `advise`. */
        enforce: ENFORCE.default(OwnerEnforcement.ADVISE),
        /** Words that say something is in public state, or that the checks pass, in the owner's language, added to the English ones. */
        claimWords: z
          .strictObject({
            /** Extra phrases, besides the English ones, that claim something is in public state; up to 20, each 3 to 60 characters; default none. */
            public: CLAIM_WORDS.default([]),
            /** Extra phrases, besides the English ones, that claim the checks pass; up to 20, each 3 to 60 characters; default none. */
            done: CLAIM_WORDS.default([]),
          })
          .prefault({}),
        /** Replies under this many words are exempt from the shape; 0 holds every reply to it. */
        shortReplyWords: SHORT_REPLY_WORDS.default(OwnerConstants.DEFAULT_SHORT_REPLY_WORDS),
      })
      .prefault({}),
  })
  .prefault({});

/** `.agents/local/profile.json`: what one developer told VULCAN about how to work with them. */
export const PROFILE_SCHEMA = z.strictObject({
  /** Version of the profile file format; must be `1`. */
  schemaVersion: z.literal(OwnerConstants.PROFILE_SCHEMA_VERSION),
  /** Reply language; labels for it come from `labels` below. A language that is not English with none has its labels written by the agent, and only the structure is checked. */
  language: LANGUAGE.optional(),
  address: z
    .strictObject({
      /** How to address the person: a name, a pronoun, an honorific, or nothing. */
      you: TEXT.optional(),
      /** How the agent refers to itself. */
      self: TEXT.optional(),
      /** How formal the address is: `informal`, `neutral` or `formal`; default `neutral`. */
      formality: FORMALITY.default(OwnerFormalities.NEUTRAL),
    })
    .prefault({}),
  /** Tone of replies: `terse`, `neutral` or `friendly`; default `neutral`. */
  tone: TONE.default(OwnerTones.NEUTRAL),
  /** How much a reply spells out: `headline` or `tables`; default `tables`. */
  reportDetail: DETAIL.default(OwnerDetails.TABLES),
  habits: z
    .strictObject({
      /** Ask before a reversible choice; false means state a default and continue (V-P-10). */
      askBeforeReversible: z.boolean().default(false),
      /** Whether the agent is told to propose commits; default `false`. */
      proposeCommits: z.boolean().default(false),
    })
    .prefault({}),
  /** In the person's own words, never scored or used to infer traits. */
  about: z.string().max(2000).optional(),
  /** Taste in code that no formatter or lint rule already enforces. */
  codeTaste: z.string().max(1000).optional(),
  /** Stricter than the project's, never looser. */
  enforce: ENFORCE.optional(),
  /** Lower than the project's, never higher: 0 holds every reply to the shape. */
  shortReplyWords: SHORT_REPLY_WORDS.optional(),
  /** The label set of each language the person uses, keyed by language code. */
  labels: z.record(LANGUAGE, OWNER_LABEL_SET).default({}),
});

export type TOwnerConfig = z.output<typeof OWNER_SCHEMA>;
export type TOwnerLabelSet = z.output<typeof OWNER_LABEL_SET>;
export type TProfile = z.output<typeof PROFILE_SCHEMA>;
