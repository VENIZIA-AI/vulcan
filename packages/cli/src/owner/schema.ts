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

/** A key that was removed: optional, and refused when present with what to do, instead of a bare "unrecognized key". */
const REMOVED_KEY = (opts: { fix: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({ code: 'custom', message: `removed: ${opts.fix}` });
    })
    .optional();

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
 * whether the shape card is shown. English and `advise` unless the project says otherwise. A person's own
 * language, address and tone live in their profile (`.agents/local/profile.json`), not here.
 */
export const OWNER_SCHEMA = z
  .strictObject({
    /** Language of the reply labels, a code such as `en` or `pt-BR`; default `en`. */
    language: LANGUAGE.default(OwnerConstants.DEFAULT_LANGUAGE),
    /** How a reply is shaped: sections, minimap columns, status words, labels, headline length, path style and whether the shape card is shown. */
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
        /** Most sentences the headline of a reply may have, 1 to 5; default 2. */
        headlineMaxSentences: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(OwnerConstants.DEFAULT_HEADLINE_MAX_SENTENCES),
        /** Whether file paths in a reply must be absolute; default `true`. */
        absolutePaths: z.boolean().default(true),
        /** Whether the session digest shows the shape card: `off` leaves it out, `advise` and `block` show it; default `advise`. */
        enforce: ENFORCE.default(OwnerEnforcement.ADVISE),
        /** Removed with the reply check, the only thing that read it. */
        claimWords: REMOVED_KEY({ fix: 'delete this key; the reply check that read it is gone' }),
        /** Removed with the reply check, the only thing that read it. */
        shortReplyWords: REMOVED_KEY({
          fix: 'delete this key; the reply check that read it is gone',
        }),
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
  /** How the agent addresses the person: what it calls them, itself, and how formal; default neutral formality. */
  address: z
    .strictObject({
      /** Form of address for the person: a name, pronoun or honorific, one line of at most 80 characters; absent means none. */
      you: TEXT.optional(),
      /** How the agent refers to itself, one line of at most 80 characters; absent means no fixed form. */
      self: TEXT.optional(),
      /** How formal the address is: `informal`, `neutral` or `formal`; default `neutral`. */
      formality: FORMALITY.default(OwnerFormalities.NEUTRAL),
    })
    .prefault({}),
  /** Tone of replies: `terse`, `neutral` or `friendly`; default `neutral`. */
  tone: TONE.default(OwnerTones.NEUTRAL),
  /** How much a reply spells out: `headline` or `tables`; default `tables`. */
  reportDetail: DETAIL.default(OwnerDetails.TABLES),
  /** Working habits the agent follows with this person; both default to `false`. */
  habits: z
    .strictObject({
      /** Ask before a reversible choice; false means state a default and continue (V-P-10). */
      askBeforeReversible: z.boolean().default(false),
      /** Whether the agent is told to propose commits; default `false`. */
      proposeCommits: z.boolean().default(false),
    })
    .prefault({}),
  /** Free text in the person's own words, up to 2000 characters; the digest card shows the first 200, and it is never scored. */
  about: z.string().max(2000).optional(),
  /** Taste in code that no formatter or lint rule enforces, up to 1000 characters; absent means none. */
  codeTaste: z.string().max(1000).optional(),
  /** Own enforcement level: `off`, `advise` or `block`; only counts when stricter than the project's, else the project's wins. */
  enforce: ENFORCE.optional(),
  /** Removed with the reply check, the only thing that read it. */
  shortReplyWords: REMOVED_KEY({ fix: 'delete this key; the reply check that read it is gone' }),
  /** The label set of each language the person uses, keyed by language code. */
  labels: z.record(LANGUAGE, OWNER_LABEL_SET).default({}),
});

export type TOwnerConfig = z.output<typeof OWNER_SCHEMA>;
export type TOwnerLabelSet = z.output<typeof OWNER_LABEL_SET>;
export type TProfile = z.output<typeof PROFILE_SCHEMA>;
