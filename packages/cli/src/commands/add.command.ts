import type { ICommandContext } from '../common/index.ts';
import { addApp } from '../create/add-app.ts';

export const runAddCommand = async (opts: ICommandContext): Promise<number> =>
  addApp({ cwd: opts.cwd, args: opts.args });
