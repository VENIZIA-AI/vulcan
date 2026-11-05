import type { ICommandContext } from '../common/index.ts';
import { runXCommand } from './x.command.ts';

/** `vulcan graph <build|status>` is `vulcan x atlas graph <build|status>`: atlas owns the graph, this is the short name. */
export const runGraphCommand = async (opts: ICommandContext): Promise<number> =>
  runXCommand({ ...opts, args: ['atlas', 'graph', ...opts.args] });
