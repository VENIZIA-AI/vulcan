import type { ICommandContext } from '../common/index.ts';
import { BoardCommand } from '../board/command.ts';

export const runBoardCommand = async (opts: ICommandContext): Promise<number> =>
  BoardCommand.run(opts);
