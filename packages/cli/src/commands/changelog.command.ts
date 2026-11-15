import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { runXCommand } from './x.command.ts';

const SUBCOMMAND = 'check';

/** `vulcan changelog check`: atlas's `changelogs check` run at the pinned version, over this project's entries. */
export const runChangelogCommand = (opts: ICommandContext): Promise<number> => {
  const rest = opts.args.slice(1);
  const isShape =
    rest.length === 0 || (rest.length === 3 && rest[0] === '--history' && rest[1] === '--base');

  if (opts.args[0] !== SUBCOMMAND || !isShape) {
    process.stderr.write(`usage: vulcan changelog ${SUBCOMMAND} [--history --base <ref>]\n`);

    return Promise.resolve(ExitCodes.USAGE);
  }

  return runXCommand({ ...opts, args: ['atlas', 'changelogs', SUBCOMMAND, ...rest] });
};
