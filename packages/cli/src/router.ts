import { COMMAND_LOADERS } from './commands/index.ts';
import { CommandTable } from './commands/table.ts';
import type { IAcceptedArgs } from './commands/table.ts';
import { ExitCodes, VulcanCommands } from './common/index.ts';
import { PipedInputRefusal } from './ui/keyboard.ts';

const HELP_ALIASES = new Set(['--help', '-h']);
const VERSION_ALIASES = new Set(['--version', '-v']);

/** The command name an argv asks for: no argument or a help flag means help. */
const resolveCommandName = (opts: { first: string | undefined }): string => {
  if (opts.first === undefined || HELP_ALIASES.has(opts.first)) {
    return VulcanCommands.HELP;
  }

  return VERSION_ALIASES.has(opts.first) ? VulcanCommands.VERSION : opts.first;
};

/** The first argument `accepted` does not cover - a typo must never run the command as if unsaid. */
const findUnknownArg = (opts: { args: string[]; accepted: IAcceptedArgs }): string | undefined => {
  let positionals = 0;

  for (let index = 0; index < opts.args.length; index++) {
    const arg = opts.args[index];

    if (opts.accepted.values.includes(arg)) {
      index++;
      continue;
    }

    if (opts.accepted.flags.includes(arg)) {
      continue;
    }

    if (arg.startsWith('-') || positionals === opts.accepted.positionals) {
      return arg;
    }

    positionals++;
  }

  return undefined;
};

const runHelp = async (opts: { cwd: string }): Promise<number> => {
  const help = await COMMAND_LOADERS[VulcanCommands.HELP]();

  return help({ args: [], cwd: opts.cwd });
};

export const runVulcan = async (opts: { argv: string[]; cwd: string }): Promise<number> => {
  const [first, ...args] = opts.argv;
  const name = resolveCommandName({ first });
  const load = COMMAND_LOADERS[name];

  if (load === undefined) {
    process.stderr.write(`vulcan: unknown command '${name}' - run 'bun x vulcan help'\n`);

    return ExitCodes.FAILURE;
  }

  // `x` hands its arguments to the tool, so only a help flag in the tool's place is vulcan's.
  if (name === VulcanCommands.X && HELP_ALIASES.has(args[0] ?? '')) {
    return runHelp({ cwd: opts.cwd });
  }

  const accepted = CommandTable.accepted({ name });

  if (accepted !== undefined) {
    if (args.some((arg) => HELP_ALIASES.has(arg))) {
      return runHelp({ cwd: opts.cwd });
    }

    const unknown = findUnknownArg({ args, accepted });

    if (unknown !== undefined) {
      process.stderr.write(
        `vulcan ${name}: unknown argument '${unknown}' - run 'bun x vulcan help'\n`,
      );

      return accepted.unknownExit ?? ExitCodes.FAILURE;
    }
  }

  const handler = await load();

  try {
    const exitCode = await handler({ args, cwd: opts.cwd });

    return exitCode;
  } catch (error) {
    // The refusal is already printed; every `finally` between the menu and here has run.
    if (error instanceof PipedInputRefusal) {
      return ExitCodes.FAILURE;
    }

    throw error;
  }
};
