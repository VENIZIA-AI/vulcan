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
  /** The runner a simple command is and the words after it, or `undefined` when it runs no package by name. */
  private static runnerOf(opts: { command: ISimpleCommand }): IRunnerCall | undefined {
    const program = ShellParser.programOf({ command: opts.command });
    const name = ShellParser.basenameOf({ word: program.name });

    if (name !== 'xargs') {
      return PackageRunners.find({ program: name, args: program.args });
    }

    // `xargs bunx` runs the program with a name from its input: read the words after xargs's own options as a command
    for (let index = 0; index < program.args.length; index += 1) {
      const word = ShellParser.basenameOf({ word: program.args[index] ?? '' });

      if (PackageRunners.isProgram({ name: word }) || PackageRunners.WRAPPERS.has(word)) {
        return PackageRunners.find({ program: word, args: program.args.slice(index + 1) });
      }
    }

    return undefined;
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
  }): IRunnerHit[] {
    const hits: IRunnerHit[] = [];
    const parsed = ShellParser.parseChecked({ command: opts.command });
    const commands = [...parsed.commands, ...parsed.unterminatedHeredocCommands];
    const env = opts.env ?? process.env;
    const start = resolve(opts.cwd ?? process.cwd());
    const folders = ShellFolders.foldersOf({
      commands,
      cwd: start,
      pwd: start,
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

      if (name === undefined) {
        continue;
      }

      const folder = folders[index];
      const isLinked =
        use.hasNoInstall &&
        use.packageName === undefined &&
        use.flags.every((flag) => PackageRunners.HARMLESS.has(flag)) &&
        folder?.isKnown === true &&
        RunnerGuard.isLinked({ name, cwd: folder.base });

      if (!isLinked) {
        hits.push(RunnerGuard.hitOf({ use, name }));
      }
    }

    return hits;
  }
}
