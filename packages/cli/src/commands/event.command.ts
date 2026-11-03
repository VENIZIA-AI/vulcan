import type { ICommandContext } from '../common/index.ts';
import { EventCommand } from '../events/command.ts';

export const runEventCommand = async (opts: ICommandContext): Promise<number> =>
  EventCommand.run(opts);
