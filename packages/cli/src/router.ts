import { COMMAND_HANDLERS } from './commands/index.ts';
import { runHelpCommand } from './commands/help.command.ts';
import { ExitCodes, UpgradeFlags, VulcanCommands } from './common/index.ts';
import { CreateFlags } from './create/common/index.ts';

const HELP_ALIASES = new Set(['--help', '-h']);
const VERSION_ALIASES = new Set(['--version', '-v']);

interface IAcceptedArgs {
  flags: string[];
  /** Flags that take the next argument as their value. */
  values: string[];
  positionals: number;
}

/** What each command takes; `x` hands everything to its tool, `help` and `version` take nothing. */
const ACCEPTED_ARGS: Record<string, IAcceptedArgs> = {
  [VulcanCommands.INIT]: {
    flags: [CreateFlags.NO_API],
    values: [
      '--config',
      CreateFlags.PRESET,
      CreateFlags.PROJECT,
      CreateFlags.BACKEND_DIR,
      CreateFlags.FRONTEND_DIR,
      CreateFlags.SHARED_DIR,
      CreateFlags.APP,
      CreateFlags.API,
    ],
    positionals: 0,
  },
  [VulcanCommands.ADD]: {
    flags: [CreateFlags.NO_API],
    values: [
      CreateFlags.PRESET,
      CreateFlags.BACKEND_DIR,
      CreateFlags.FRONTEND_DIR,
      CreateFlags.APP,
      CreateFlags.API,
    ],
    positionals: 0,
  },
  [VulcanCommands.SYNC]: { flags: ['--dry-run', '--prune'], values: [], positionals: 0 },
  [VulcanCommands.DOCTOR]: { flags: [], values: [], positionals: 0 },
  [VulcanCommands.UPGRADE]: {
    flags: [UpgradeFlags.STABLE, UpgradeFlags.NIGHTLY],
    values: [],
    positionals: 1,
  },
};

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

export const runVulcan = async (opts: { argv: string[]; cwd: string }): Promise<number> => {
  const [first, ...args] = opts.argv;
  const name = resolveCommandName({ first });
  const handler = COMMAND_HANDLERS[name];

  if (handler === undefined) {
    process.stderr.write(`vulcan: unknown command '${name}' - run 'bun x vulcan help'\n`);

    return ExitCodes.FAILURE;
  }

  // `x` hands its arguments to the tool, so only a help flag in the tool's place is vulcan's.
  if (name === VulcanCommands.X && HELP_ALIASES.has(args[0] ?? '')) {
    return runHelpCommand();
  }

  const accepted = ACCEPTED_ARGS[name];

  if (accepted !== undefined) {
    if (args.some(arg => HELP_ALIASES.has(arg))) {
      return runHelpCommand();
    }

    const unknown = findUnknownArg({ args, accepted });

    if (unknown !== undefined) {
      process.stderr.write(
        `vulcan ${name}: unknown argument '${unknown}' - run 'bun x vulcan help'\n`,
      );

      return ExitCodes.FAILURE;
    }
  }

  return handler({ args, cwd: opts.cwd });
};
