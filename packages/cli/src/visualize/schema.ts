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
import { CompareSchema } from './compare-schema.ts';
import {
  GradesSchema,
  LifecycleSchema,
  MetricsSchema,
  SequenceSchema,
  TreeSchema,
} from './kinds-schema.ts';
import { SourceSchema, TermsSchema } from './sources.ts';

/** One line of plain text: no markup is interpreted anywhere, it is all escaped. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^(?=.*\S)[^\p{Cc}\u202A-\u202E\u2066-\u2069]+$/u, 'one line of text, not blank');
/**
 * A question or an option label is read, not parsed: no backtick, arrow function, snake_case name, dotted call, flag, brace or angle bracket. What needs code goes in the detail of the decision or in a code block.
 */
const CODE_LIKE = /`|=>|\w_\w|\.\w+\(|(?:^|\s)--\w|[<>{}]/;
const plain = (max: number) =>
  text(max).refine((value) => !CODE_LIKE.test(value), 'no code here: put it in the detail');
/** One line of a code block: it may be indented or empty, and holds no control character. */
const CodeLineSchema = z
  .string()
  .max(VisualizeLimits.MAX_CODE_LINE)
  .regex(/^[^\p{Cc}\u202A-\u202E\u2066-\u2069]*$/u, 'one line of code');
/** A closed set as a pattern, so the printed JSON Schema says the same as the renderer. */
const choice = (opts: { set: Iterable<string> }) =>
  z
    .string()
    .regex(new RegExp(`^(${[...opts.set].join('|')})$`), `one of: ${[...opts.set].join(', ')}`);
const IdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, 'lowercase letters, digits and -, at most 32');
const GridSchema = z
  .number()
  .int()
  .min(0)
  .max(VisualizeLimits.MAX_GRID - 1);
/** A link is https and nothing else: no script, no data, no relative path to guess at. */
const HttpsSchema = z
  .string()
  .max(500)
  .regex(/^https:\/\/[^\s"'<>\p{Cc}]+$/u, 'an https URL');
const HexColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a six-digit hex colour like #3f5266');
const rows = <T extends z.ZodType>(item: T) =>
  z.array(item).min(1).max(VisualizeLimits.MAX_ROWS_PER_TABLE);

const StateSchema = choice({ set: NodeStates.SCHEME_SET });

const NodeSchema = z.strictObject({
  id: IdSchema,
  label: text(VisualizeLimits.MAX_LABEL),
  sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
  detail: text(VisualizeLimits.MAX_DETAIL).optional(),
  row: GridSchema,
  col: GridSchema,
  type: choice({ set: NodeKinds.values() }).optional(),
  state: StateSchema.optional(),
  /** Where the box comes from: shown as `repo@commit:path:lines` in its detail. */
  source: SourceSchema.optional(),
});

const EdgeSchema = z.strictObject({
  from: IdSchema,
  to: IdSchema,
  /** Every arrow says what it does: a verb. */
  label: text(VisualizeLimits.MAX_EDGE_LABEL),
  variant: choice({ set: EdgeVariants.values() }).optional(),
});

const StepSchema = z.strictObject({
  title: text(VisualizeLimits.MAX_LABEL),
  note: text(VisualizeLimits.MAX_SENTENCE),
  nodes: z.array(IdSchema).max(VisualizeLimits.MAX_NODES).default([]),
  /** An edge is named `from>to`. */
  edges: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*>[a-z][a-z0-9-]*$/))
    .max(VisualizeLimits.MAX_EDGES)
    .default([]),
  source: SourceSchema.optional(),
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
const NumberSchema = z.number().finite().min(-1_000_000_000).max(1_000_000_000);

const ComparisonSchema = z.strictObject({
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

const IdeaMapSchema = z.strictObject({
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

const DiagramSchema = z.discriminatedUnion('type', [
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

const ExplainerSchema = z.strictObject({
  steps: z
    .array(
      z.strictObject({
        title: text(VisualizeLimits.MAX_LABEL),
        text: text(VisualizeLimits.MAX_SENTENCE),
        diagram: DiagramSchema.optional(),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_EXPLAINER_STEPS),
});

const ArchitectureSchema = z.strictObject({
  layers: z
    .array(
      z.strictObject({
        label: text(VisualizeLimits.MAX_LABEL),
        boxes: z
          .array(
            z.strictObject({
              id: IdSchema,
              label: text(VisualizeLimits.MAX_LABEL),
              sub: text(VisualizeLimits.MAX_LABEL).optional(),
              state: StateSchema.optional(),
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
      z.strictObject({
        from: IdSchema,
        to: IdSchema,
        label: text(VisualizeLimits.MAX_EDGE_LABEL).optional(),
      }),
    )
    .max(VisualizeLimits.MAX_LINKS)
    .default([]),
});

const TimelineSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        date: text(VisualizeLimits.MAX_LABEL),
        title: text(VisualizeLimits.MAX_LABEL),
        text: text(VisualizeLimits.MAX_SENTENCE).optional(),
        state: StateSchema.optional(),
      }),
    )
    .min(2)
    .max(VisualizeLimits.MAX_TIMELINE),
});

const CellSchema = text(VisualizeLimits.MAX_CELL);
const TOO_MANY_POINTS = `at most ${VisualizeLimits.MAX_POINTS} points: more than that is a table`;

/** The charts that need no choice of form from the agent: the page draws them as the data says. */
const MORE_CHARTS = [
  z.strictObject({
    type: z.literal('stack'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    groups: z
      .array(text(VisualizeLimits.MAX_LABEL))
      .min(2)
      .max(VisualizeLimits.MAX_POINTS, TOO_MANY_POINTS),
    /** One value per group, from zero up; the series past the fifth are added up into "Other". */
    series: z
      .array(
        z.strictObject({
          name: text(VisualizeLimits.MAX_LABEL),
          values: z.array(NumberSchema.min(0)).min(2).max(VisualizeLimits.MAX_POINTS),
        }),
      )
      .min(2)
      .max(VisualizeLimits.MAX_STACK_SERIES),
  }),
  z.strictObject({
    type: z.literal('meter'),
    title: text(VisualizeLimits.MAX_LABEL),
    rows: z
      .array(
        z.strictObject({
          label: text(VisualizeLimits.MAX_LABEL),
          value: NumberSchema.min(0),
          /** The limit or the whole the value is read against. */
          of: NumberSchema.positive(),
          unit: text(16).optional(),
        }),
      )
      .min(1)
      .max(VisualizeLimits.MAX_METERS),
  }),
  z.strictObject({
    type: z.literal('table'),
    title: text(VisualizeLimits.MAX_LABEL),
    columns: z.array(text(VisualizeLimits.MAX_LABEL)).min(2).max(VisualizeLimits.MAX_TABLE_COLUMNS),
    rows: z.array(z.array(CellSchema)).min(1).max(VisualizeLimits.MAX_TABLE_ROWS),
  }),
] as const;

const ChartSchema = z.discriminatedUnion('type', [
  ...MORE_CHARTS,
  z.strictObject({
    type: z.literal('bar'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    labels: z
      .array(text(VisualizeLimits.MAX_LABEL))
      .min(2)
      .max(VisualizeLimits.MAX_POINTS, TOO_MANY_POINTS),
    /** One value per label. A negative value draws the bars around a zero line. */
    values: z.array(NumberSchema).min(2).max(VisualizeLimits.MAX_POINTS, TOO_MANY_POINTS),
  }),
  z.strictObject({
    type: z.literal('line'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    labels: z
      .array(text(VisualizeLimits.MAX_LABEL))
      .min(3)
      .max(VisualizeLimits.MAX_POINTS, TOO_MANY_POINTS),
    series: z
      .array(
        z.strictObject({
          name: text(VisualizeLimits.MAX_LABEL),
          values: z.array(NumberSchema).min(3).max(VisualizeLimits.MAX_POINTS),
        }),
      )
      .min(1)
      .max(VisualizeLimits.MAX_SERIES),
    /** The name of the one series that is the point: it takes the accent, the others turn gray. */
    emphasis: text(VisualizeLimits.MAX_LABEL).optional(),
  }),
  z.strictObject({
    type: z.literal('donut'),
    title: text(VisualizeLimits.MAX_LABEL),
    unit: text(16).optional(),
    parts: z
      .array(
        z.strictObject({
          label: text(VisualizeLimits.MAX_LABEL),
          value: NumberSchema.min(0),
          state: StateSchema.optional(),
        }),
      )
      .min(2)
      .max(VisualizeLimits.MAX_PARTS),
  }),
]);

/** What a written section holds: a small typed list, never markup. `code` spans inside a text are shown as code. */
const BlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('p'), text: text(VisualizeLimits.MAX_SENTENCE) }),
  z.strictObject({ type: z.literal('quote'), text: text(VisualizeLimits.MAX_SENTENCE) }),
  z.strictObject({
    type: z.literal('code'),
    lines: z.array(CodeLineSchema).min(1).max(VisualizeLimits.MAX_CODE_LINES),
  }),
  z.strictObject({ type: z.literal('ul'), items: LIST(12) }),
  z.strictObject({ type: z.literal('ol'), items: LIST(12) }),
]);

const FindingsSchema = z.strictObject({
  numbers: z
    .array(
      z.strictObject({
        value: text(16),
        label: text(VisualizeLimits.MAX_LABEL),
        state: StateSchema.optional(),
        /** Where the figure is heading: a small line beside it, no axis. */
        trend: z.array(NumberSchema).min(3).max(VisualizeLimits.MAX_POINTS).optional(),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_TILES)
    .optional(),
  charts: z.array(ChartSchema).min(1).max(VisualizeLimits.MAX_CHARTS).optional(),
  callouts: z
    .array(
      z.strictObject({ text: text(VisualizeLimits.MAX_SENTENCE), state: StateSchema.optional() }),
    )
    .min(1)
    .max(4)
    .optional(),
});

const DecisionRecordSchema = z.strictObject({
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
const ChromeSchema = z
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
    nodeKinds: z
      .strictObject({
        step: text(VisualizeLimits.MAX_LABEL).optional(),
        service: text(VisualizeLimits.MAX_LABEL).optional(),
        store: text(VisualizeLimits.MAX_LABEL).optional(),
        actor: text(VisualizeLimits.MAX_LABEL).optional(),
        external: text(VisualizeLimits.MAX_LABEL).optional(),
      })
      .optional(),
    edgeVariants: z
      .strictObject({
        main: text(VisualizeLimits.MAX_LABEL).optional(),
        branch: text(VisualizeLimits.MAX_LABEL).optional(),
        return: text(VisualizeLimits.MAX_LABEL).optional(),
        fanout: text(VisualizeLimits.MAX_LABEL).optional(),
        error: text(VisualizeLimits.MAX_LABEL).optional(),
      })
      .optional(),
  })
  .optional();

/** The spec of one page, strict: an unknown key is a typo, and a typo is an error. */
export const VisualizeSpecSchema = z.strictObject({
  schemaVersion: z.literal(VisualizeLimits.SCHEMA_VERSION),
  /** The takeaway, not a topic. */
  title: text(VisualizeLimits.MAX_TITLE),
  /** The accent of this page; it wins over the project's `theme`. A six-digit hex colour. */
  accent: HexColourSchema.optional(),
  /** The accent on dark grounds; derived from `accent` when absent. */
  accentDark: HexColourSchema.optional(),
  /** A darker accent for text, when `accent` is too light to be read as text. */
  accentText: HexColourSchema.optional(),
  status: z.strictObject({
    state: choice({ set: StatusStates.values() }),
    label: text(VisualizeLimits.MAX_LABEL).optional(),
  }),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  scope: text(VisualizeLimits.MAX_SENTENCE).optional(),
  /** The verdict: one sentence the reader can stop at. */
  verdict: text(VisualizeLimits.MAX_SENTENCE),
  strip: z
    .strictObject({
      healthy: text(VisualizeLimits.MAX_SENTENCE).optional(),
      blockedBy: text(VisualizeLimits.MAX_SENTENCE).optional(),
      changed: text(VisualizeLimits.MAX_SENTENCE).optional(),
      next: text(VisualizeLimits.MAX_SENTENCE),
    })
    .optional(),
  /** Where each task stands, one row each: the owner's map of the work. */
  minimap: rows(
    z.strictObject({
      task: text(VisualizeLimits.MAX_STEP_NAME),
      status: choice({ set: MinimapStates.values() }),
      note: text(VisualizeLimits.MAX_STEP_NOTE).optional(),
    }),
  ).optional(),
  /** What the owner has to do, in order: shown as a numbered checklist under `strip.next`. */
  actions: LIST().optional(),
  flow: z
    .strictObject({
      nodes: z.array(NodeSchema).min(1).max(VisualizeLimits.MAX_NODES),
      edges: z.array(EdgeSchema).max(VisualizeLimits.MAX_EDGES).default([]),
      steps: z.array(StepSchema).max(VisualizeLimits.MAX_STEPS).default([]),
    })
    .optional(),
  architecture: ArchitectureSchema.optional(),
  comparison: ComparisonSchema.optional(),
  ideaMap: IdeaMapSchema.optional(),
  explainer: ExplainerSchema.optional(),
  timeline: TimelineSchema.optional(),
  findings: FindingsSchema.optional(),
  grades: GradesSchema.optional(),
  metrics: MetricsSchema.optional(),
  sequence: SequenceSchema.optional(),
  lifecycle: LifecycleSchema.optional(),
  tree: TreeSchema.optional(),
  compare: CompareSchema.optional(),
  /** The words of the page a reader may not know; one that never appears in the page is a warning. */
  terms: TermsSchema.optional(),
  decisionRecord: DecisionRecordSchema.optional(),
  beforeAfter: z
    .strictObject({ before: SIDE(ChangeKinds.REMOVED), after: SIDE(ChangeKinds.ADDED) })
    .optional(),
  decisions: z
    .array(
      z.strictObject({
        question: plain(VisualizeLimits.MAX_QUESTION).regex(/\?$/, 'a question ends with ?'),
        options: z
          .array(
            z.strictObject({
              label: plain(VisualizeLimits.MAX_OPTION_LABEL),
              effect: text(VisualizeLimits.MAX_OPTION_EFFECT),
              recommended: z.boolean().optional(),
            }),
          )
          .min(2)
          .max(3),
        why: text(VisualizeLimits.MAX_WHY),
        detail: text(VisualizeLimits.MAX_DECISION_DETAIL).optional(),
      }),
    )
    .min(1)
    .max(5)
    .optional(),
  /** Background to read: a titled section of paragraphs, code, quotes and lists. */
  sections: z
    .array(
      z.strictObject({
        title: text(VisualizeLimits.MAX_LABEL),
        blocks: z.array(BlockSchema).min(1).max(VisualizeLimits.MAX_BLOCKS),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_SECTIONS)
    .optional(),
  evidence: rows(
    z.strictObject({
      claim: text(VisualizeLimits.MAX_SENTENCE),
      probe: text(VisualizeLimits.MAX_SENTENCE),
      result: text(VisualizeLimits.MAX_SENTENCE),
      label: choice({ set: EvidenceLabels.values() }),
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
  links: rows(
    z.strictObject({ label: text(VisualizeLimits.MAX_LABEL), href: HttpsSchema }),
  ).optional(),
  chrome: ChromeSchema,
});

export type TVisualizeSpec = z.output<typeof VisualizeSpecSchema>;
