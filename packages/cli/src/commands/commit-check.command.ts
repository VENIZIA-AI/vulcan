import type { ICommandContext } from '../common/index.ts';
import { CommitCheck } from '../commit/index.ts';

export const runCommitCheckCommand = async (opts: ICommandContext): Promise<number> =>
  CommitCheck.run(opts);
