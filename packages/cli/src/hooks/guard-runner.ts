import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GuardDecisions } from './common/index.ts';
import { PackageRunners } from './package-runners.ts';
import type { IRunnerCall } from './package-runners.ts';
import { RunnerScan } from './runner-scan.ts';
import type { IRunnerUse } from './runner-scan.ts';
import { ShellFolders } from './shell-folders.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

/** One reason a command is refused: a package run by name. */
export interface IRunnerHit {
  rule: 'V-S-08';
  message: string;
  decision: typeof GuardDecisions.DENY;
}

/**
 * V-S-08 for an agent: a command that runs a package by name (`bunx`, `pnpx`, `bun x`, `npx`, `npm exec`, `pnpm dlx`,
 * `yarn dlx`, also behind `corepack` or `xargs`) is denied. The name may belong to somebody else on npm, and bun runs a
 * copy an earlier bunx saved even under `--no-install`. A scoped package (`@scope/name`) and the names of
 * `guard.runners.allow` pass, and so does the `--no-install` form of `bun x` when `node_modules/.bin/<bin>` exists in the
 * folder the command runs in or above it, with no flag but `--bun`, `--silent` and `--no-install`: that is the one case that
 * cannot reach the cache. It reads the commands the parser found, so a word in a message, a grep or a heredoc is data.
 */
export class RunnerGuard {
  /** Programs that run the command after their own options, which the shell parser does not unwrap. */
  private static readonly LAUNCHERS: ReadonlySet<string> = new Set([
    'xargs',
    'nsenter',
    'chroot',
    'setsid',
    'unshare',
  ]);

  /** The runner a simple command is and the words after it, or `undefined` when it runs no package by name. */
  private static runnerOf(opts: { command: ISimpleCommand }): IRunnerCall | undefined {
    const program = ShellParser.programOf({ command: opts.command });
    const name = ShellParser.basenameOf({ word: program.name });

    if (!RunnerGuard.LAUNCHERS.has(name)) {
      return PackageRunners.find({ program: name, args: program.args });
    }

    // `xargs bunx` runs the program with a name from its input: read the words after the launcher's own options as a command
    for (let index = 0; index < program.args.length; index += 1) {
      const word = ShellParser.basenameOf({ word: program.args[index] ?? '' });

      if (PackageRunners.isProgram({ name: word }) || PackageRunners.WRAPPERS.has(word)) {
        return PackageRunners.find({ program: word, args: program.args.slice(index + 1) });
      }
    }

    return undefined;
  }

  /**
   * Whether a command of the line moves the shell's folder in a way `ShellFolders` does not follow: `env -C <dir>`,
   * `env --chdir=<dir>`, and `eval`, `source` or `.`, whose text is a line of its own. Then no folder is known.
   */
  private static movesFolder(opts: { command: ISimpleCommand }): boolean {
    const names = opts.command.words.map((word) => ShellParser.basenameOf({ word }));
    const program = ShellParser.basenameOf({
      word: ShellParser.programOf({ command: opts.command }).name,
    });

    if (
      ['eval', 'source', '.'].includes(program) ||
      names.some((name) => ['eval', 'source'].includes(name))
    ) {
      return true;
    }

    const at = names.indexOf('env');
    const isChdir = (word: string): boolean => /^--chdir(?:=|$)/.test(word);

    return (
      (at !== -1 &&
        opts.command.words
          .slice(at + 1)
          .some((word) => isChdir(word) || /^-[A-Za-z]*C/.test(word))) ||
      (names.includes('sudo') &&
        opts.command.words.some((word) => isChdir(word) || /^-[A-Za-z]*D/.test(word))) ||
      names.includes('chroot') ||
      (names.includes('nsenter') && opts.command.words.some((word) => /^(?:--wd|-w)/.test(word))) ||
      (names.includes('find') &&
        opts.command.words.some((word) => /^-(?:execdir|okdir)$/.test(word)))
    );
  }

  /** Whether `node_modules/.bin/<name>` exists in `cwd` or a folder above it: bun resolves a linked bin up the tree. */
  private static isLinked(opts: { name: string; cwd: string }): boolean {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(opts.name)) {
      return false;
    }

    let directory = resolve(opts.cwd);

    while (true) {
      if (existsSync(join(directory, 'node_modules', '.bin', opts.name))) {
        return true;
      }

      const parent = dirname(directory);

      if (parent === directory) {
        return false;
      }

      directory = parent;
    }
  }

  private static hitOf(opts: { use: IRunnerUse; name: string }): IRunnerHit {
    const bin = RunnerScan.bareName({ name: opts.name });
    const what =
      opts.name === ''
        ? `\`${opts.use.runner}\` with no package named on its command line fetches whatever its input names`
        : `\`${opts.use.runner} ${opts.name}\` fetches a package by name`;

    return {
      rule: 'V-S-08',
      decision: GuardDecisions.DENY,
      message: `${what}, and npm may give that name to someone else (bun also runs a copy an earlier bunx saved, even with --no-install). Use \`bun run ${bin === '' ? '<bin>' : bin}\` in the package that depends on it, or node_modules/.bin/${bin === '' ? '<bin>' : bin}; the --no-install form is accepted only when node_modules/.bin/${bin === '' ? '<bin>' : bin} exists in the folder the command runs in and it has no other flag than --bun and --silent.`,
    };
  }

  static inspect(opts: {
    command: string;
    cwd: string | undefined;
    allow: string[];
    env?: Record<string, string | undefined>;
    /** False when `cwd` is only where the session started and not where the line runs (the string of an `npx -c` inside a folder change). */
    isKnown?: boolean;
  }): IRunnerHit[] {
    const hits: IRunnerHit[] = [];
    const parsed = ShellParser.parseChecked({ command: opts.command });
    const commands = [...parsed.commands, ...parsed.unterminatedHeredocCommands];
    const env = opts.env ?? process.env;
    const start = resolve(opts.cwd ?? process.cwd());
    const isFolderUnknown =
      opts.isKnown === false || commands.some((command) => RunnerGuard.movesFolder({ command }));
    const folders = ShellFolders.foldersOf({
      commands,
      cwd: start,
      pwd: start,
      isKnown: opts.isKnown,
      home: env.HOME ?? '',
      env,
    });

    for (const [index, command] of commands.entries()) {
      const call = RunnerGuard.runnerOf({ command });

      if (call === undefined) {
        continue;
      }

      const use = RunnerScan.useOf({ call, line: 0, isExample: false });
      const name = RunnerScan.refusedName({ use, allow: opts.allow });

      const folder = folders[index];

      // `npx -c '<line>'` runs the line in a shell: it is read as a command line of its own, and passes when that has no runner
      if (RunnerScan.isCommandString({ use })) {
        const line = PackageRunners.commandStringOf({ words: call.words });

        if (line !== undefined) {
          hits.push(
            ...RunnerGuard.inspect({
              command: line,
              cwd: folder?.isKnown === true ? folder.base : start,
              allow: opts.allow,
              env,
              isKnown: folder?.isKnown === true && !isFolderUnknown,
            }),
          );
        }

        continue;
      }

      if (name === undefined) {
        continue;
      }

      const isLinked =
        use.hasNoInstall &&
        use.packageName === undefined &&
        use.flags.every((flag) => PackageRunners.HARMLESS.has(flag)) &&
        !isFolderUnknown &&
        folder?.isKnown === true &&
        RunnerGuard.isLinked({ name, cwd: folder.base });

      if (!isLinked) {
        hits.push(RunnerGuard.hitOf({ use, name }));
      }
    }

    return hits;
  }
}
