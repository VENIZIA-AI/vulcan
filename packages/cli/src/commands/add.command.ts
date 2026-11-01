import type { ICommandContext } from '../common/index.ts';
import { AppScaffold } from '../create/add-app.ts';

export const runAddCommand = async (opts: ICommandContext): Promise<number> =>
  AppScaffold.add({ cwd: opts.cwd, args: opts.args });
