import { ExitCodes } from '../common/index.ts';
import { CreateConstants } from './common/index.ts';

/** `bun` commands init and add run; VULCAN_NO_INSTALL=1 (tests) prints them instead. */
export const isInstallSkipped = (): boolean => process.env[CreateConstants.NO_INSTALL_ENV] === '1';

/** The `bun` this process runs, unless a test replaced it. */
export const bunExecutable = (): string => process.env[CreateConstants.BUN_ENV] ?? process.execPath;

/**
 * Any command, under the same skip rule as `runBun`; a skipped one counts as done. A quiet command
 * prints nothing while it runs: its output is kept and written only when it fails.
 */
export const runCommand = async (opts: {
  cwd: string;
  command: string[];
  label: string;
  quiet?: boolean;
}): Promise<number> => {
  if (isInstallSkipped()) {
    process.stderr.write(`  skipped  ${opts.label} (VULCAN_NO_INSTALL)\n`);

    return ExitCodes.OK;
  }

  if (opts.quiet !== true) {
    const child = Bun.spawn(opts.command, {
      cwd: opts.cwd,
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    return child.exited;
  }

  const child = Bun.spawn(opts.command, {
    cwd: opts.cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== ExitCodes.OK) {
    process.stderr.write(`${stdout}${stderr}`);
  }

  return code;
};

export const runBun = async (opts: {
  cwd: string;
  args: string[];
  label: string;
  quiet?: boolean;
}): Promise<number> =>
  runCommand({
    cwd: opts.cwd,
    command: [bunExecutable(), ...opts.args],
    label: opts.label,
    quiet: opts.quiet,
  });

/**
 * `git init` on the new project. A machine without git (or with one too old for `-b`) still gets a
 * working project: the missing step is printed for the user to run, and the flow goes on.
 */
export const runGitInit = async (opts: { cwd: string }): Promise<number> => {
  const git = process.env[CreateConstants.GIT_ENV] ?? 'git';
  let code: number = ExitCodes.FAILURE;

  try {
    const exitCode = await runCommand({
      cwd: opts.cwd,
      command: [git, 'init', '-q', '-b', 'develop'],
      label: 'git init',
    });

    code = exitCode;
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
