import { z } from 'zod';
import { OwnerConstants, OwnerEnforcement } from '../../../owner/constants.ts';
import {
  EnforceSchema,
  LanguageSchema,
  OwnerLabelSetSchema,
  SectionSchema,
  TextSchema,
} from '../../../owner/schema.ts';
import { REMOVED_OKF_KEY } from '../../common/schema.ts';

const DEFAULTS = OwnerConstants.DEFAULT_LABELS;

/**
 * The project's report contract for answers to its owners: the shape, the status words, the labels and
 * whether the shape card is shown. English and `advise` unless the project says otherwise. A person's own
 * language, address and tone live in their profile (`.agents/local/profile.json`), not here.
 */
export const OwnerConfigSchema = z
  .strictObject({
    /** Language of the reply labels, a code such as `en` or `pt-BR`; default `en`. */
    language: LanguageSchema.default(OwnerConstants.DEFAULT_LANGUAGE),
    /** How a reply is shaped: sections, minimap columns, status words, labels, headline length, path style and whether the shape card is shown. */
    report: z
      .strictObject({
        /** Sections of a reply, in order: headline, minimap, blocked, detail, decisions; at least one, default all five in that order. */
        shape: z.array(SectionSchema).min(1).default(OwnerConstants.DEFAULT_SHAPE),
        /** Three minimap column headers; default `#`, `Task`, `Status`. */
        minimapColumns: z
          .tuple([TextSchema, TextSchema, TextSchema])
          .default(DEFAULTS.minimapColumns),
        /** Status words of the minimap; default the English set (done, in progress, waiting, not started, blocked, dropped). */
        status: OwnerLabelSetSchema.shape.status.default(DEFAULTS.status),
        /** Labels of the blocked and decisions parts; default the English set. */
        labels: OwnerLabelSetSchema.shape.labels.default(DEFAULTS.labels),
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
        enforce: EnforceSchema.default(OwnerEnforcement.ADVISE),
        /** Removed with the reply check, the only thing that read it. */
        claimWords: REMOVED_OKF_KEY({
          fix: 'delete this key; the reply check that read it is gone',
        }),
        /** Removed with the reply check, the only thing that read it. */
        shortReplyWords: REMOVED_OKF_KEY({
          fix: 'delete this key; the reply check that read it is gone',
        }),
      })
      .prefault({}),
  })
  .prefault({});

export const OWNER_SECTION = {
  /** The report contract for answers to the project's owners; English and `advise` by default. */
  owner: OwnerConfigSchema,
};
