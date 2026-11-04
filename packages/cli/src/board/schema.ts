import { z } from 'zod';
import { BoardAgentSetting } from './agent-setting.ts';
import { BoardConstants, BoardShapes } from './common/index.ts';

const SHAPE = z.custom<string>((value) => typeof value === 'string' && BoardShapes.isValid(value), {
  message: `one of ${[...BoardShapes.SCHEME_SET].join(', ')}`,
});

/** A face, or `{ shape?, lane?, role? }`: the lane labels the agent "under" another listed agent on its own card; the role is what the card says it is. */
export const BOARD_AGENT = z.union([
  SHAPE,
  z.strictObject({
    shape: SHAPE.optional(),
    lane: z.string().min(1).optional(),
    role: z.string().trim().min(1).max(BoardConstants.ROLE_MAX).optional(),
  }),
]);

/** The agents of a board by name. */
export const BOARD_AGENTS = z
  .record(z.string().min(1), BOARD_AGENT)
  .superRefine((settings, context) => {
    for (const name of Object.keys(settings)) {
      const message = BoardAgentSetting.problemOf({ settings, name });

      if (message !== undefined) {
        context.addIssue({ code: 'custom', message, path: [name, 'lane'] });
      }
    }
  });

export type TBoardAgentSetting = z.output<typeof BOARD_AGENT>;
