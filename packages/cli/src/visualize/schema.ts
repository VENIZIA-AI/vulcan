import { z } from 'zod';
import {
  ChangeKinds,
  DEFAULT_CHROME,
  EdgeVariants,
  EvidenceLabels,
  MinimapStates,
  NodeKinds,
  NodeStates,
  StatusStates,
  VisualizeLimits,
} from './constants.ts';
import type { TChangeKind } from './constants.ts';

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

const STATE = choice({ set: NodeStates.SCHEME_SET });

const NODE = z.strictObject({
  id: ID,
  label: text(VisualizeLimits.MAX_LABEL),
  sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
  detail: text(VisualizeLimits.MAX_DETAIL).optional(),
  row: GRID,
  col: GRID,
  kind: choice({ set: NodeKinds.SCHEME_SET }).optional(),
  state: STATE.optional(),
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

const SIDE = (changed: TChangeKind) =>
  z.strictObject({
    title: text(VisualizeLimits.MAX_LABEL),
    items: rows(
      z.strictObject({
        text: text(VisualizeLimits.MAX_SENTENCE),
        change: choice({ set: new Set(['same', changed]) }).optional(),
      }),
    ),
  });

const LIST = (max = VisualizeLimits.MAX_LIST) =>
  z.array(text(VisualizeLimits.MAX_SENTENCE)).min(1).max(max);
const NUMBER = z.number().finite().min(-1_000_000_000).max(1_000_000_000);

const COMPARISON = z.strictObject({
  criteria: z.array(text(VisualizeLimits.MAX_LABEL)).min(1).max(VisualizeLimits.MAX_CRITERIA),
  options: z
    .array(
      z.strictObject({
        name: text(VisualizeLimits.MAX_LABEL),
        line: text(VisualizeLimits.MAX_SENTENCE).optional(),
        /** One score from 1 to 5 per criterion, in the order of `criteria`. */
        scores: z.array(z.number().int().min(1).max(5)).min(1).max(VisualizeLimits.MAX_CRITERIA),
        pros: LIST().optional(),
        cons: LIST().optional(),
        recommended: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(VisualizeLimits.MAX_COMPARE_OPTIONS),
  note: text(VisualizeLimits.MAX_SENTENCE).optional(),
});

const IDEA_MAP = z.strictObject({
  center: text(VisualizeLimits.MAX_LABEL),
  branches: z
    .array(
      z.strictObject({
        label: text(VisualizeLimits.MAX_LABEL),
        items: z
          .array(text(VisualizeLimits.MAX_LABEL))
          .min(1)
          .max(VisualizeLimits.MAX_BRANCH_ITEMS),
        note: text(VisualizeLimits.MAX_SENTENCE).optional(),
      }),
    )
    .min(2)
    .max(VisualizeLimits.MAX_BRANCHES),
});

const DIAGRAM = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('row'),
    nodes: z
      .array(
        z.strictObject({
          label: text(VisualizeLimits.MAX_LABEL),
          sub: text(VisualizeLimits.MAX_LABEL).optional(),
        }),
      )
      .min(2)
      .max(5),
    /** Labels of the arrows between consecutive boxes; one fewer than the boxes. */
    arrows: z.array(text(VisualizeLimits.MAX_EDGE_LABEL)).max(4).optional(),
  }),
  z.strictObject({
    type: z.literal('layers'),
    layers: z
      .array(
        z.strictObject({
          label: text(VisualizeLimits.MAX_LABEL),
          items: z.array(text(VisualizeLimits.MAX_LABEL)).min(1).max(5),
        }),
      )
      .min(2)
      .max(VisualizeLimits.MAX_LAYERS),
  }),
]);

const EXPLAINER = z.strictObject({
  steps: z
    .array(
      z.strictObject({
        title: text(VisualizeLimits.MAX_LABEL),
        text: text(VisualizeLimits.MAX_SENTENCE),
        diagram: DIAGRAM.optional(),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_EXPLAINER_STEPS),
});

const ARCHITECTURE = z.strictObject({
  layers: z
    .array(
      z.strictObject({
        label: text(VisualizeLimits.MAX_LABEL),
        boxes: z
          .array(
            z.strictObject({
              id: ID,
              label: text(VisualizeLimits.MAX_LABEL),
              sub: text(VisualizeLimits.MAX_LABEL).optional(),
              state: STATE.optional(),
            }),
          )
          .min(1)
          .max(VisualizeLimits.MAX_LAYER_BOXES),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_LAYERS),
  links: z
    .array(
      z.strictObject({ from: ID, to: ID, label: text(VisualizeLimits.MAX_EDGE_LABEL).optional() }),
    )
    .max(VisualizeLimits.MAX_LINKS)
    .default([]),
});

const TIMELINE = z.strictObject({
  items: z
    .array(
      z.strictObject({
        date: text(VisualizeLimits.MAX_LABEL),
        title: text(VisualizeLimits.MAX_LABEL),
        text: text(VisualizeLimits.MAX_SENTENCE).optional(),
        state: STATE.optional(),
      }),
    )
    .min(2)
    .max(VisualizeLimits.MAX_TIMELINE),
});

const CHART = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bar'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    labels: z.array(text(VisualizeLimits.MAX_LABEL)).min(2).max(VisualizeLimits.MAX_POINTS),
    /** One value per label, from zero up: a bar starts at the baseline. */
    values: z.array(NUMBER.min(0)).min(2).max(VisualizeLimits.MAX_POINTS),
  }),
  z.strictObject({
    type: z.literal('line'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    labels: z.array(text(VisualizeLimits.MAX_LABEL)).min(3).max(VisualizeLimits.MAX_POINTS),
    series: z
      .array(
        z.strictObject({
          name: text(VisualizeLimits.MAX_LABEL),
          values: z.array(NUMBER).min(3).max(VisualizeLimits.MAX_POINTS),
        }),
      )
      .min(1)
      .max(VisualizeLimits.MAX_SERIES),
  }),
  z.strictObject({
    type: z.literal('donut'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    parts: z
      .array(
        z.strictObject({
          label: text(VisualizeLimits.MAX_LABEL),
          value: NUMBER.min(0),
          state: STATE.optional(),
        }),
      )
      .min(2)
      .max(VisualizeLimits.MAX_PARTS),
  }),
]);

const FINDINGS = z.strictObject({
  numbers: z
    .array(
      z.strictObject({
        value: text(16),
        label: text(VisualizeLimits.MAX_LABEL),
        state: STATE.optional(),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_TILES)
    .optional(),
  charts: z.array(CHART).min(1).max(VisualizeLimits.MAX_CHARTS).optional(),
  callouts: z
    .array(z.strictObject({ text: text(VisualizeLimits.MAX_SENTENCE), state: STATE.optional() }))
    .min(1)
    .max(4)
    .optional(),
});

const DECISION_RECORD = z.strictObject({
  context: text(VisualizeLimits.MAX_SENTENCE),
  options: z
    .array(
      z.strictObject({
        name: text(VisualizeLimits.MAX_LABEL),
        summary: text(VisualizeLimits.MAX_SENTENCE),
        chosen: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(5),
  decision: text(VisualizeLimits.MAX_SENTENCE),
  consequences: LIST(),
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
    minimapStates: z
      .strictObject({
        done: text(VisualizeLimits.MAX_LABEL).optional(),
        'in-progress': text(VisualizeLimits.MAX_LABEL).optional(),
        waiting: text(VisualizeLimits.MAX_LABEL).optional(),
        'not-started': text(VisualizeLimits.MAX_LABEL).optional(),
        blocked: text(VisualizeLimits.MAX_LABEL).optional(),
        dropped: text(VisualizeLimits.MAX_LABEL).optional(),
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
  /** Where each task stands, one row each: the owner's map of the work. */
  minimap: rows(
    z.strictObject({
      task: text(VisualizeLimits.MAX_LABEL),
      status: choice({ set: MinimapStates.SCHEME_SET }),
      note: text(VisualizeLimits.MAX_SENTENCE).optional(),
    }),
  ).optional(),
  /** What the owner has to do, in order: shown as a numbered checklist under `strip.next`. */
  actions: LIST().optional(),
  /** Key numbers; with a `minimap` and no tiles, the page counts the states itself. */
  tiles: z
    .array(
      z.strictObject({
        value: text(16),
        label: text(VisualizeLimits.MAX_LABEL),
        state: STATE.optional(),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_TILES)
    .optional(),
  flow: z
    .strictObject({
      nodes: z.array(NODE).min(1).max(VisualizeLimits.MAX_NODES),
      edges: z.array(EDGE).max(VisualizeLimits.MAX_EDGES).default([]),
      steps: z.array(STEP).max(VisualizeLimits.MAX_STEPS).default([]),
    })
    .optional(),
  architecture: ARCHITECTURE.optional(),
  comparison: COMPARISON.optional(),
  ideaMap: IDEA_MAP.optional(),
  explainer: EXPLAINER.optional(),
  timeline: TIMELINE.optional(),
  findings: FINDINGS.optional(),
  decisionRecord: DECISION_RECORD.optional(),
  beforeAfter: z
    .strictObject({ before: SIDE(ChangeKinds.REMOVED), after: SIDE(ChangeKinds.ADDED) })
    .optional(),
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
