import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { runXCommand } from './x.command.ts';

const SUBCOMMAND = 'check';

/** `vulcan changelog check`: atlas's `changelogs check` run at the pinned version, over this project's entries. */
export const runChangelogCommand = (opts: ICommandContext): Promise<number> => {
  if (opts.args[0] !== SUBCOMMAND || opts.args.length > 1) {
    process.stderr.write(`usage: vulcan changelog ${SUBCOMMAND}\n`);

    return Promise.resolve(ExitCodes.USAGE);
  }

  return runXCommand({ ...opts, args: ['atlas', 'changelogs', SUBCOMMAND] });
};
