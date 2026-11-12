import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { runXCommand } from './x.command.ts';

const SUBCOMMANDS = new Set(['plan', 'apply']);

/** `vulcan migrate plan|apply`: atlas's `migrate` run at the pinned version, over the sources this project serves. */
export const runMigrateCommand = (opts: ICommandContext): Promise<number> => {
  if (!SUBCOMMANDS.has(opts.args[0] ?? '')) {
    process.stderr.write(
      'usage: vulcan migrate plan [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json]\n       vulcan migrate apply [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--force]\n',
    );

    return Promise.resolve(ExitCodes.USAGE);
  }

  return runXCommand({ ...opts, args: ['atlas', 'migrate', ...opts.args] });
};
