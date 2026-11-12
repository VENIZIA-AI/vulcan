import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { runXCommand } from './x.command.ts';

const SUBCOMMAND = 'plan';

/** `vulcan migrate plan`: atlas's `migrate plan` run at the pinned version, over the sources this project serves. */
export const runMigrateCommand = (opts: ICommandContext): Promise<number> => {
  if (opts.args[0] !== SUBCOMMAND) {
    process.stderr.write(
      `usage: vulcan migrate ${SUBCOMMAND} [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json]\n`,
    );

    return Promise.resolve(ExitCodes.USAGE);
  }

  return runXCommand({ ...opts, args: ['atlas', 'migrate', ...opts.args] });
};
