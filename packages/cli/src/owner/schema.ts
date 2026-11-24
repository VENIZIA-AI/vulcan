import { z } from 'zod';
import { MACHINE_KEYS } from '../agents/local.ts';
import {
  OwnerConstants,
  OwnerDetails,
  OwnerEnforcement,
  OwnerFormalities,
  OwnerSections,
  OwnerTones,
} from './constants.ts';

/** One line of at most 80 characters, with no backtick, pipe or quote. */
export const TEXT = z.string().regex(OwnerConstants.LABEL_PATTERN, {
  message: 'one line of at most 80 characters, with no backtick, pipe or quote',
});
/** A language code such as `en` or `pt-BR`. */
export const LANGUAGE = z.string().regex(OwnerConstants.LANGUAGE_PATTERN, {
  message: 'a language code such as en or pt-BR',
});
const choice = (opts: { isValid: (value: string) => boolean; set: Iterable<string> }) =>
  z.string().refine((value) => opts.isValid(value), {
    message: `one of: ${[...opts.set].join(', ')}`,
  });

/** A section of a reply, one of `OwnerSections`. */
export const SECTION = choice({
  isValid: (value) => OwnerSections.isValid(value),
  set: OwnerSections.values(),
});
/** An enforcement level, one of `OwnerEnforcement`. */
export const ENFORCE = choice({
  isValid: (value) => OwnerEnforcement.isValid(value),
  set: OwnerEnforcement.values(),
});
const TONE = choice({ isValid: (value) => OwnerTones.isValid(value), set: OwnerTones.values() });
const FORMALITY = choice({
  isValid: (value) => OwnerFormalities.isValid(value),
  set: OwnerFormalities.values(),
});
const DETAIL = choice({
  isValid: (value) => OwnerDetails.isValid(value),
  set: OwnerDetails.values(),
});

/** A key that was removed: optional, and refused when present with what to do, instead of a bare "unrecognized key". */
const REMOVED_KEY = (opts: { fix: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({ code: 'custom', message: `removed: ${opts.fix}` });
    })
    .optional();

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
 * `.agents/local/profile.json`: the one per-developer file. What one developer told VULCAN about how to work with them, and
 * this machine's own keys (`agents`, `board`, `local`, `events`: the shapes of `MACHINE_KEYS`), which `vulcan project sync` and the hooks read.
 */
export const PROFILE_SCHEMA = z.strictObject({
  ...MACHINE_KEYS,
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

export type TOwnerLabelSet = z.output<typeof OWNER_LABEL_SET>;
export type TProfile = z.output<typeof PROFILE_SCHEMA>;
