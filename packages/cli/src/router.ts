import { COMMAND_HANDLERS } from './commands/index.ts';
import { ExitCodes, VulcanCommands } from './common/index.ts';

const HELP_ALIASES = new Set(['--help', '-h']);
const VERSION_ALIASES = new Set(['--version', '-v']);

/** The command name an argv asks for: no argument or a help flag means help. */
const resolveCommandName = (opts: { first: string | undefined }): string => {
  if (opts.first === undefined || HELP_ALIASES.has(opts.first)) {
    return VulcanCommands.HELP;
  }

  return VERSION_ALIASES.has(opts.first) ? VulcanCommands.VERSION : opts.first;
};

export const runVulcan = async (opts: { argv: string[]; cwd: string }): Promise<number> => {
  const [first, ...args] = opts.argv;
  const name = resolveCommandName({ first });
  const handler = COMMAND_HANDLERS[name];

  if (handler === undefined) {
    process.stderr.write(`vulcan: unknown command '${name}' - run 'bun x vulcan help'\n`);

    return ExitCodes.FAILURE;
  }

  return handler({ args, cwd: opts.cwd });
};
