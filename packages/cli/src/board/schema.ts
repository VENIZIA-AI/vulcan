import { z } from 'zod';
import { BoardAgentSetting } from './agent-setting.ts';
import { BoardConstants, BoardShapes } from './common/index.ts';

const ShapeSchema = z.custom<string>(
  (value) => typeof value === 'string' && BoardShapes.isValid(value),
  {
    message: `one of ${BoardShapes.values().join(', ')}`,
  },
);

/** A face, or `{ shape?, lane?, role? }`: the lane labels the agent "under" another listed agent on its own card; the role is what the card says it is. */
export const BoardAgentSettingSchema = z.union([
  ShapeSchema,
  z.strictObject({
    /** Face of the agent: `bun`, `flame`, `ember`, `rock` or `banana`. */
    shape: ShapeSchema.optional(),
    /** Name of another listed agent this one is shown under on its card; at least one character, and that agent has no lane of its own. */
    lane: z.string().min(1).optional(),
    /** What the card says the agent is; trimmed, 1 to 60 characters. */
    role: z.string().trim().min(1).max(BoardConstants.ROLE_MAX).optional(),
  }),
]);

/** The agents of a board by name. */
export const BoardAgentsSchema = z
  .record(z.string().min(1), BoardAgentSettingSchema)
  .superRefine((settings, context) => {
    for (const name of Object.keys(settings)) {
      const message = BoardAgentSetting.problemOf({ settings, name });

      if (message !== undefined) {
        context.addIssue({ code: 'custom', message, path: [name, 'lane'] });
      }
    }
  });

export type TBoardAgentSetting = z.output<typeof BoardAgentSettingSchema>;
