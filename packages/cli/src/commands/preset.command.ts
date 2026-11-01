import type { ICommandContext } from '../common/index.ts';
import { PresetDiff } from '../create/preset-diff.ts';

export const runPresetCommand = async (opts: ICommandContext): Promise<number> =>
  PresetDiff.run({ cwd: opts.cwd, args: opts.args });
