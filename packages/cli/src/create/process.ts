import { ExitCodes } from '../common/index.ts';
import { CreateConstants } from './common/index.ts';

/** `bun` commands init and add run; VULCAN_NO_INSTALL=1 (tests) prints them instead. */
export const isInstallSkipped = (): boolean => process.env[CreateConstants.NO_INSTALL_ENV] === '1';

/** The `bun` this process runs, unless a test replaced it. */
export const bunExecutable = (): string => process.env[CreateConstants.BUN_ENV] ?? process.execPath;

/** Any command, under the same skip rule as `runBun`; a skipped one counts as done. */
export const runCommand = async (opts: {
  cwd: string;
  command: string[];
  label: string;
}): Promise<number> => {
  if (isInstallSkipped()) {
    process.stderr.write(`  skipped  ${opts.label} (VULCAN_NO_INSTALL)\n`);

    return ExitCodes.OK;
  }

  const child = Bun.spawn(opts.command, {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return child.exited;
};

export const runBun = async (opts: {
  cwd: string;
  args: string[];
  label: string;
}): Promise<number> =>
  runCommand({ cwd: opts.cwd, command: [bunExecutable(), ...opts.args], label: opts.label });

/**
 * `git init` on the new project. A machine without git (or with one too old for `-b`) still gets a
 * working project: the missing step is printed for the user to run, and the flow goes on.
 */
export const runGitInit = async (opts: { cwd: string }): Promise<number> => {
  const git = process.env[CreateConstants.GIT_ENV] ?? 'git';
  let code: number = ExitCodes.FAILURE;

  try {
    code = await runCommand({
      cwd: opts.cwd,
      command: [git, 'init', '-q', '-b', 'develop'],
      label: 'git init',
    });
  } catch {
    // Bun.spawn throws when the executable is not there; the message below says what to do.
  }

  if (code !== ExitCodes.OK) {
    process.stderr.write(
      `vulcan init: git init did not run - install git, then run: git init -b develop (in ${opts.cwd})\n`,
    );
  }

  return ExitCodes.OK;
};
