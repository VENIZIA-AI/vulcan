import { z } from 'zod';
import { BoardShapes } from './common/index.ts';

const SHAPE = z.custom<string>((value) => typeof value === 'string' && BoardShapes.isValid(value), {
  message: `one of ${[...BoardShapes.SCHEME_SET].join(', ')}`,
});

/** A face, or `{ shape?, lane? }`: the lane rolls the agent into the row of another listed agent. */
export const BOARD_AGENT = z.union([
  SHAPE,
  z.strictObject({ shape: SHAPE.optional(), lane: z.string().min(1).optional() }),
]);

export type TBoardAgent = z.infer<typeof BOARD_AGENT>;

export class BoardAgent {
  static shapeOf(opts: { agent: TBoardAgent }): string | undefined {
    return typeof opts.agent === 'string' ? opts.agent : opts.agent.shape;
  }

  static laneOf(opts: { agent: TBoardAgent }): string | undefined {
    return typeof opts.agent === 'string' ? undefined : opts.agent.lane;
  }

  /** Why the lane of `name` cannot be honoured, or `undefined`. A lane names a listed agent with no lane of its own, so there is no chain and no cycle. */
  static problemOf(opts: {
    agents: Record<string, TBoardAgent>;
    name: string;
  }): string | undefined {
    const { agents, name } = opts;
    const lane = BoardAgent.laneOf({ agent: agents[name] });

    if (lane === undefined) {
      return undefined;
    }

    const target = agents[lane];

    if (lane === name) {
      return `'${name}' cannot be its own lane`;
    }

    if (target === undefined) {
      return `lane '${lane}' of '${name}' is not a key of board.agents`;
    }

    return BoardAgent.laneOf({ agent: target }) === undefined
      ? undefined
      : `lane '${lane}' of '${name}' has a lane of its own: a lane cannot be a helper`;
  }
}

/** The agents of a board by name. */
export const BOARD_AGENTS = z
  .record(z.string().min(1), BOARD_AGENT)
  .superRefine((agents, context) => {
    for (const name of Object.keys(agents)) {
      const message = BoardAgent.problemOf({ agents, name });

      if (message !== undefined) {
        context.addIssue({ code: 'custom', message, path: [name, 'lane'] });
      }
    }
  });
