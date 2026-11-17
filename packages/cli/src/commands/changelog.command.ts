import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { runXCommand } from './x.command.ts';

const SUBCOMMAND = 'check';
const NOTES = 'notes';
const USAGE = `usage: vulcan changelog ${SUBCOMMAND} [--history --base <ref>] | ${NOTES} --version <X.Y.Z> [--migration]`;

/**
 * `vulcan changelog check` and `vulcan changelog notes`: atlas's `changelogs` command run at the pinned version, over this
 * project's entries.
 */
export const runChangelogCommand = (opts: ICommandContext): Promise<number> => {
  const rest = opts.args.slice(1);
  const isShape =
    rest.length === 0 || (rest.length === 3 && rest[0] === '--history' && rest[1] === '--base');

  if (opts.args[0] === NOTES) {
    const isNotes =
      rest[0] === '--version' &&
      rest[1] !== undefined &&
      (rest.length === 2 || (rest.length === 3 && rest[2] === '--migration'));

    if (!isNotes) {
      process.stderr.write(`${USAGE}\n`);

      return Promise.resolve(ExitCodes.USAGE);
    }

    return runXCommand({ ...opts, args: ['atlas', 'changelogs', NOTES, ...rest] });
  }

  if (opts.args[0] !== SUBCOMMAND || !isShape) {
    process.stderr.write(`${USAGE}\n`);

    return Promise.resolve(ExitCodes.USAGE);
  }

  return runXCommand({ ...opts, args: ['atlas', 'changelogs', SUBCOMMAND, ...rest] });
};
