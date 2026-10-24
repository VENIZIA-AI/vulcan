import { z } from 'zod';
import {
  DEFAULT_CHROME,
  EdgeVariants,
  EvidenceLabels,
  NodeKinds,
  StatusStates,
  VisualizeLimits,
} from './constants.ts';

/** One line of plain text: no markup is interpreted anywhere, it is all escaped. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^(?=.*\S)[^\p{Cc}\u202A-\u202E\u2066-\u2069]+$/u, 'one line of text, not blank');
/** A closed set as a pattern, so the printed JSON Schema says the same as the renderer. */
const choice = (opts: { set: Set<string> }) =>
  z
    .string()
    .regex(new RegExp(`^(${[...opts.set].join('|')})$`), `one of: ${[...opts.set].join(', ')}`);
const ID = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, 'lowercase letters, digits and -, at most 32');
const GRID = z
  .number()
  .int()
  .min(0)
  .max(VisualizeLimits.MAX_GRID - 1);
/** A link is https and nothing else: no script, no data, no relative path to guess at. */
const HTTPS = z
  .string()
  .max(500)
  .regex(/^https:\/\/[^\s"'<>\p{Cc}]+$/u, 'an https URL');
const rows = <T extends z.ZodType>(item: T) =>
  z.array(item).min(1).max(VisualizeLimits.MAX_ROWS_PER_TABLE);

const NODE = z.strictObject({
  id: ID,
  label: text(VisualizeLimits.MAX_LABEL),
  sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
  detail: text(VisualizeLimits.MAX_DETAIL).optional(),
  row: GRID,
  col: GRID,
  kind: choice({ set: NodeKinds.SCHEME_SET }).optional(),
});

const EDGE = z.strictObject({
  from: ID,
  to: ID,
  /** Every arrow says what it does: a verb. */
  label: text(VisualizeLimits.MAX_EDGE_LABEL),
  variant: choice({ set: EdgeVariants.SCHEME_SET }).optional(),
});

const STEP = z.strictObject({
  title: text(VisualizeLimits.MAX_LABEL),
  note: text(VisualizeLimits.MAX_SENTENCE),
  nodes: z.array(ID).max(VisualizeLimits.MAX_NODES).default([]),
  /** An edge is named `from>to`. */
  edges: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*>[a-z][a-z0-9-]*$/))
    .max(VisualizeLimits.MAX_EDGES)
    .default([]),
});

const SIDE = (changed: 'added' | 'removed') =>
  z.strictObject({
    title: text(VisualizeLimits.MAX_LABEL),
    items: rows(
      z.strictObject({
        text: text(VisualizeLimits.MAX_SENTENCE),
        change: choice({ set: new Set(['same', changed]) }).optional(),
      }),
    ),
  });

/** The words of the page, English by default; any of them may be replaced (the owner's language). */
const CHROME = z
  .strictObject({
    ...Object.fromEntries(
      Object.entries(DEFAULT_CHROME)
        .filter(([, value]) => typeof value === 'string')
        .map(([key]) => [key, text(VisualizeLimits.MAX_LABEL).optional()]),
    ),
    statusStates: z
      .strictObject({
        ok: text(VisualizeLimits.MAX_LABEL).optional(),
        warn: text(VisualizeLimits.MAX_LABEL).optional(),
        blocked: text(VisualizeLimits.MAX_LABEL).optional(),
        info: text(VisualizeLimits.MAX_LABEL).optional(),
      })
      .optional(),
    evidenceLabels: z
      .strictObject({
        verified: text(VisualizeLimits.MAX_LABEL).optional(),
        inferred: text(VisualizeLimits.MAX_LABEL).optional(),
        guess: text(VisualizeLimits.MAX_LABEL).optional(),
      })
      .optional(),
  })
  .optional();

/** The spec of one page, strict: an unknown key is a typo, and a typo is an error. */
export const VISUALIZE_SCHEMA = z.strictObject({
  schemaVersion: z.literal(VisualizeLimits.SCHEMA_VERSION),
  /** The takeaway, not a topic. */
  title: text(VisualizeLimits.MAX_TITLE),
  language: z
    .string()
    .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/)
    .default('en'),
  status: z.strictObject({
    state: choice({ set: StatusStates.SCHEME_SET }),
    label: text(VisualizeLimits.MAX_LABEL).optional(),
  }),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  scope: text(VisualizeLimits.MAX_SENTENCE).optional(),
  /** The verdict: one sentence the reader can stop at. */
  verdict: text(VisualizeLimits.MAX_SENTENCE),
  caption: text(VisualizeLimits.MAX_SENTENCE).optional(),
  strip: z
    .strictObject({
      healthy: text(VisualizeLimits.MAX_SENTENCE),
      blockedBy: text(VisualizeLimits.MAX_SENTENCE),
      changed: text(VisualizeLimits.MAX_SENTENCE),
      next: text(VisualizeLimits.MAX_SENTENCE),
    })
    .optional(),
  flow: z
    .strictObject({
      nodes: z.array(NODE).min(1).max(VisualizeLimits.MAX_NODES),
      edges: z.array(EDGE).max(VisualizeLimits.MAX_EDGES).default([]),
      steps: z.array(STEP).max(VisualizeLimits.MAX_STEPS).default([]),
    })
    .optional(),
  beforeAfter: z.strictObject({ before: SIDE('removed'), after: SIDE('added') }).optional(),
  decisions: z
    .array(
      z.strictObject({
        question: text(VisualizeLimits.MAX_SENTENCE),
        recommended: text(VisualizeLimits.MAX_SENTENCE),
        changes: text(VisualizeLimits.MAX_SENTENCE),
      }),
    )
    .min(1)
    .max(5)
    .optional(),
  evidence: rows(
    z.strictObject({
      claim: text(VisualizeLimits.MAX_SENTENCE),
      probe: text(VisualizeLimits.MAX_SENTENCE),
      result: text(VisualizeLimits.MAX_SENTENCE),
      label: choice({ set: EvidenceLabels.SCHEME_SET }),
    }),
  ).optional(),
  risks: rows(
    z.strictObject({
      risk: text(VisualizeLimits.MAX_SENTENCE),
      impact: text(VisualizeLimits.MAX_SENTENCE),
      fallback: text(VisualizeLimits.MAX_SENTENCE),
    }),
  ).optional(),
  /** Newest first. */
  log: rows(
    z.strictObject({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      text: text(VisualizeLimits.MAX_SENTENCE),
    }),
  ).optional(),
  links: rows(z.strictObject({ label: text(VisualizeLimits.MAX_LABEL), href: HTTPS })).optional(),
  chrome: CHROME,
});

export type TVisualizeSpec = z.output<typeof VISUALIZE_SCHEMA>;
