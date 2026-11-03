import type { ICommandContext } from '../common/index.ts';
import { CiCommand } from '../ci/command.ts';

export const runCiCommand = async (opts: ICommandContext): Promise<number> => CiCommand.run(opts);
