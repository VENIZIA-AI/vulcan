import { z } from 'zod';
import { NodeKinds, NodeStates, VisualizeLimits } from './constants.ts';
import { SourceSchema } from './sources.ts';
import { ConstClass } from '../common/types.ts';

/** Which of the two versions an edge belongs to: both, only the first (a), or only the second (b). */
export class EdgeSides extends ConstClass {
  static readonly BOTH = 'both';
  static readonly A = 'a';
  static readonly B = 'b';
}

/** The limits of the compare view; the shared ones come from `VisualizeLimits`. */
export class CompareLimits {
  /** The name of a side is read in a sentence with `only here`, so it is short. */
  static readonly MAX_SIDE = 24;
}

/** One line of plain text: no markup is interpreted anywhere, it is all escaped. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^(?=.*\S)[^\p{Cc}‪-‮⁦-⁩]+$/u, 'one line of text, not blank');
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

/** Two versions of one mechanism as one figure: the boxes they share, and the arrows each has or lacks. */
export const CompareSchema = z.strictObject({
  /** The name of the first version. */
  a: text(CompareLimits.MAX_SIDE),
  /** The name of the second version. */
  b: text(CompareLimits.MAX_SIDE),
  nodes: z
    .array(
      z.strictObject({
        id: IdSchema,
        label: text(VisualizeLimits.MAX_LABEL),
        sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
        row: GridSchema,
        col: GridSchema,
        type: choice({ set: NodeKinds.values() }).optional(),
        state: choice({ set: NodeStates.SCHEME_SET }).optional(),
        source: SourceSchema.optional(),
      }),
    )
    .min(2)
    .max(VisualizeLimits.MAX_NODES),
  edges: z
    .array(
      z.strictObject({
        from: IdSchema,
        to: IdSchema,
        /** Every arrow says what it does: a verb. */
        label: text(VisualizeLimits.MAX_EDGE_LABEL),
        /** Absent, the arrow is in both versions. */
        in: choice({ set: EdgeSides.values() }).optional(),
      }),
    )
    .min(1)
    .max(VisualizeLimits.MAX_EDGES),
  /** The sentence under the figure; absent, the page counts the changed arrows itself. */
  caption: text(VisualizeLimits.MAX_SENTENCE).optional(),
});

export type TCompare = z.output<typeof CompareSchema>;
