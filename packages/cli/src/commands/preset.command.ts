import type { ICommandContext } from '../common/index.ts';
import { runPresetDiff } from '../create/preset-diff.ts';

export const runPresetCommand = async (opts: ICommandContext): Promise<number> =>
  runPresetDiff({ cwd: opts.cwd, args: opts.args });
