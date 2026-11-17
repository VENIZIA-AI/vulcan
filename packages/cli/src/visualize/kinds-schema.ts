import { z } from 'zod';
import { NodeStates, VisualizeLimits } from './constants.ts';

/** How a message in a sequence is drawn: a call, the reply to it, or a call that does not wait. */
export class MessageKinds {
  static readonly CALL = 'call';
  static readonly REPLY = 'reply';
  static readonly ASYNC = 'async';
  static readonly SCHEME_SET = new Set<string>([this.CALL, this.REPLY, this.ASYNC]);
}

/** What a state is in a lifecycle: where it begins, a state in between, or where it ends. */
export class LifecycleKinds {
  static readonly START = 'start';
  static readonly NORMAL = 'normal';
  static readonly END = 'end';
  static readonly SCHEME_SET = new Set<string>([this.START, this.NORMAL, this.END]);
}

/** The limits of the three kinds; the shared ones come from `VisualizeLimits`. */
export class NewKindLimits {
  static readonly MIN_PARTICIPANTS = 2;
  static readonly MAX_PARTICIPANTS = 6;
  static readonly MAX_MESSAGES = 20;
  static readonly MIN_STATES = 2;
  static readonly MAX_STATES = 10;
  static readonly MAX_TRANSITIONS = 20;
  /** Levels below the root. */
  static readonly MAX_TREE_DEPTH = 4;
  static readonly MAX_TREE_NODES = VisualizeLimits.MAX_NODES;
}

/** One line of plain text: no markup is interpreted anywhere, it is all escaped. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^(?=.*\S)[^\p{Cc}‪-‮⁦-⁩]+$/u, 'one line of text, not blank');
/** A closed set as a pattern, so the printed JSON Schema says the same as the renderer. */
const choice = (opts: { set: Set<string> }) =>
  z
    .string()
    .regex(new RegExp(`^(${[...opts.set].join('|')})$`), `one of: ${[...opts.set].join(', ')}`);
const ID = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, 'lowercase letters, digits and -, at most 32');

/** Who talks to whom over time: lanes for the participants, one arrow per message, in order. */
export const SEQUENCE_SCHEMA = z.strictObject({
  participants: z
    .array(
      z.strictObject({
        id: ID,
        label: text(VisualizeLimits.MAX_LABEL),
        sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
      }),
    )
    .min(NewKindLimits.MIN_PARTICIPANTS)
    .max(NewKindLimits.MAX_PARTICIPANTS),
  messages: z
    .array(
      z.strictObject({
        from: ID,
        to: ID,
        /** A verb phrase: what the sender does. */
        label: text(VisualizeLimits.MAX_EDGE_LABEL),
        kind: choice({ set: MessageKinds.SCHEME_SET }).optional(),
        note: text(VisualizeLimits.MAX_LABEL).optional(),
      }),
    )
    .min(1)
    .max(NewKindLimits.MAX_MESSAGES),
  /** The sentence under the figure; absent, the page counts the parts itself. */
  caption: text(VisualizeLimits.MAX_SENTENCE).optional(),
});

/** States and what moves a thing from one to the next: one start, at least one end. */
export const LIFECYCLE_SCHEMA = z.strictObject({
  states: z
    .array(
      z.strictObject({
        id: ID,
        label: text(VisualizeLimits.MAX_LABEL),
        sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
        kind: choice({ set: LifecycleKinds.SCHEME_SET }).optional(),
      }),
    )
    .min(NewKindLimits.MIN_STATES)
    .max(NewKindLimits.MAX_STATES),
  transitions: z
    .array(
      z.strictObject({
        from: ID,
        to: ID,
        /** The trigger: what makes the state change. */
        label: text(VisualizeLimits.MAX_EDGE_LABEL),
      }),
    )
    .max(NewKindLimits.MAX_TRANSITIONS)
    .default([]),
  caption: text(VisualizeLimits.MAX_SENTENCE).optional(),
});

/** One node of the tree and what hangs under it. */
export interface ITreeNode {
  id: string;
  label: string;
  sublabel?: string | undefined;
  state?: string | undefined;
  children?: ITreeNode[] | undefined;
}

const treeNode = (opts: { level: number }): z.ZodType<ITreeNode> =>
  z.strictObject({
    id: ID,
    label: text(VisualizeLimits.MAX_LABEL),
    sublabel: text(VisualizeLimits.MAX_LABEL).optional(),
    state: choice({ set: NodeStates.SCHEME_SET }).optional(),
    children:
      opts.level >= NewKindLimits.MAX_TREE_DEPTH
        ? z
            .array(z.never())
            .max(0, `the tree goes at most ${NewKindLimits.MAX_TREE_DEPTH} levels below the root`)
            .optional()
        : z
            .array(treeNode({ level: opts.level + 1 }))
            .min(1)
            .max(NewKindLimits.MAX_TREE_NODES - 1)
            .optional(),
  });

/** A hierarchy: a root, children nested up to four levels, at most 25 nodes in all. */
export const TREE_SCHEMA = z.strictObject({
  root: treeNode({ level: 0 }),
  caption: text(VisualizeLimits.MAX_SENTENCE).optional(),
});

/** The letter of a grade: A is good, B has gaps, C is weak. */
export class GradeLetters {
  static readonly A = 'A';
  static readonly B = 'B';
  static readonly C = 'C';
  static readonly SCHEME_SET = new Set<string>([this.A, this.B, this.C]);
}

/** The colour of a part of a bar: the page's state tones. */
const PART_TONE = choice({ set: new Set(['ok', 'warn', 'bad', 'info']) });

/** A grade for each area, as a chip that always shows its letter. */
export const GRADES_SCHEMA = z
  .array(
    z.strictObject({
      label: text(VisualizeLimits.MAX_LABEL),
      grade: choice({ set: GradeLetters.SCHEME_SET }),
      note: text(VisualizeLimits.MAX_SENTENCE).optional(),
    }),
  )
  .min(1)
  .max(12);

/** Numbers as cards: a value, what it is of, and a bar split into its parts. */
export const METRICS_SCHEMA = z
  .array(
    z.strictObject({
      value: text(16),
      of: text(16).optional(),
      label: text(VisualizeLimits.MAX_LABEL),
      note: text(VisualizeLimits.MAX_SENTENCE).optional(),
      parts: z
        .array(
          z.strictObject({
            label: text(VisualizeLimits.MAX_LABEL),
            value: z.number().min(0).max(1_000_000_000),
            tone: PART_TONE.default('info'),
          }),
        )
        .min(2)
        .max(6)
        .refine((parts) => parts.some((part) => part.value > 0), 'at least one part is above zero'),
    }),
  )
  .min(1)
  .max(6);

export type TSequence = z.output<typeof SEQUENCE_SCHEMA>;
export type TLifecycle = z.output<typeof LIFECYCLE_SCHEMA>;
export type TTree = z.output<typeof TREE_SCHEMA>;
export type TGrades = z.output<typeof GRADES_SCHEMA>;
export type TMetrics = z.output<typeof METRICS_SCHEMA>;
