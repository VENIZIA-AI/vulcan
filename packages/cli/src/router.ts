import { AgentConstants } from './agents/index.ts';
import { COMMAND_LOADERS } from './commands/index.ts';
import { BoardFlags } from './board/common/index.ts';
import { CiFlags } from './ci/common/index.ts';
import { CommitCheckFlags } from './commit/common/index.ts';
import { ExitCodes, UpgradeFlags, VulcanCommands } from './common/index.ts';
import { CreateFlags } from './create/common/index.ts';
import { EventFlags } from './events/common/index.ts';
import { PipedInputRefusal } from './ui/keyboard.ts';

const HELP_ALIASES = new Set(['--help', '-h']);
const VERSION_ALIASES = new Set(['--version', '-v']);

interface IAcceptedArgs {
  flags: string[];
  /** The exit code for an argument the command does not take; `1` when absent. */
  unknownExit?: number;
  /** Flags that take the next argument as their value. */
  values: string[];
  positionals: number;
}

/** What each command takes; `x` hands everything to its tool, `help` and `version` take nothing. */
const ACCEPTED_ARGS: Record<string, IAcceptedArgs> = {
  [VulcanCommands.INIT]: {
    flags: [CreateFlags.NO_API],
    values: [
      CreateFlags.PRESET,
      CreateFlags.PROJECT,
      CreateFlags.BACKEND_DIR,
      CreateFlags.FRONTEND_DIR,
      CreateFlags.SHARED_DIR,
      CreateFlags.APP,
      CreateFlags.API,
      CreateFlags.SCOPE,
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
      CreateFlags.LIB,
      CreateFlags.SHARED,
      CreateFlags.DIR,
      CreateFlags.SCOPE,
    ],
    positionals: 0,
  },
  [VulcanCommands.PRESET]: {
    flags: [CreateFlags.NO_API, CreateFlags.FULL, CreateFlags.CHECK],
    values: [CreateFlags.PRESET, CreateFlags.API],
    positionals: 2,
  },
  [VulcanCommands.SYNC]: {
    flags: ['--dry-run'],
    values: [AgentConstants.FLAG],
    positionals: 0,
  },
  [VulcanCommands.AGENTS]: { flags: ['--dry-run'], values: [], positionals: 2 },
  [VulcanCommands.CLEAN]: {
    flags: [
      '--tmp',
      '--worktrees',
      '--clones',
      '--cache',
      '--reports',
      '--prototypes',
      '--profile',
      '--events',
      '--release-candidates',
      '--all',
      '--yes',
    ],
    values: [],
    positionals: 0,
  },
  [VulcanCommands.COMMIT_CHECK]: {
    flags: [],
    unknownExit: ExitCodes.USAGE,
    values: [CommitCheckFlags.RANGE, CommitCheckFlags.TEXT],
    positionals: 2,
  },
  [VulcanCommands.BOARD]: {
    flags: [BoardFlags.OPEN, BoardFlags.NO_GITHUB],
    unknownExit: ExitCodes.USAGE,
    values: [BoardFlags.OUT, BoardFlags.SINCE, BoardFlags.DIR, BoardFlags.REPO],
    positionals: 0,
  },
  [VulcanCommands.CI]: {
    flags: [CiFlags.JSON, CiFlags.NAMES],
    unknownExit: ExitCodes.USAGE,
    values: [CiFlags.BASE, CiFlags.HEAD, CiFlags.CHECK],
    positionals: 2,
  },
  [VulcanCommands.EVENT]: {
    flags: [EventFlags.JSON],
    unknownExit: ExitCodes.USAGE,
    values: [
      EventFlags.KIND,
      EventFlags.SUMMARY,
      EventFlags.FLOW,
      EventFlags.REF,
      EventFlags.STATUS,
      EventFlags.TITLE,
      EventFlags.WHY,
      EventFlags.ACTOR,
      EventFlags.DIR,
      EventFlags.SINCE,
    ],
    positionals: 1,
  },
  [VulcanCommands.DOCTOR]: { flags: [], values: [], positionals: 0 },
  [VulcanCommands.PROFILE]: { flags: ['--yes'], values: [], positionals: 1 },
  [VulcanCommands.VISUALIZE]: { flags: ['--schema'], values: ['--out'], positionals: 1 },
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

  const accepted = ACCEPTED_ARGS[name];

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
