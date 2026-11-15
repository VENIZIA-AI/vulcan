import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GuardDecisions } from './common/index.ts';
import { RunnerScan } from './runner-scan.ts';
import type { IRunnerUse } from './runner-scan.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

/** One reason a command is refused: a package run by name. */
export interface IRunnerHit {
  rule: 'V-S-08';
  message: string;
  decision: typeof GuardDecisions.DENY;
}

/** Programs that fetch a package by name, and the word after them that makes them do it. */
const RUNNERS: Record<string, string[]> = {
  bunx: [],
  npx: [],
  npm: ['exec', 'x'],
  pnpm: ['dlx'],
  yarn: ['dlx'],
};

/**
 * V-S-08 for an agent: a command that runs a package by name (`bunx`, `bun x`, `npx`, `npm exec`, `pnpm dlx`,
 * `yarn dlx`) is denied. The name may belong to somebody else on npm, and bun runs a copy an earlier bunx saved
 * even under `--no-install`. A scoped `@venizia/*` package and the names of `guard.runners.allow` pass, and so does
 * the `--no-install` form of `bun x` when `node_modules/.bin/<bin>` exists here or above: that is the one case that cannot
 * reach the cache. It reads the commands the parser found, so a word in a message, a grep or a heredoc is data.
 */
export class RunnerGuard {
  /** The runner a simple command is and the words after it, or `undefined` when it runs no package by name. */
  private static runnerOf(opts: {
    command: ISimpleCommand;
  }): { runner: string; words: string[] } | undefined {
    const program = ShellParser.programOf({ command: opts.command });
    const name = ShellParser.basenameOf({ word: program.name });

    if (name === 'bun') {
      const x = program.args.findIndex((word) => !word.startsWith('-'));

      return program.args[x] === 'x'
        ? { runner: 'bun x', words: program.args.slice(x + 1) }
        : undefined;
    }

    const subcommands = RUNNERS[name];

    if (subcommands === undefined) {
      return undefined;
    }

    if (subcommands.length === 0) {
      return { runner: name, words: program.args };
    }

    return subcommands.includes(program.args[0] ?? '')
      ? { runner: `${name} ${program.args[0]}`, words: program.args.slice(1) }
      : undefined;
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

  private static hitOf(opts: { use: IRunnerUse; name: string; isNoInstall: boolean }): IRunnerHit {
    const bin = RunnerScan.bareName({ name: opts.name });

    return {
      rule: 'V-S-08',
      decision: GuardDecisions.DENY,
      message: `\`${opts.use.runner} ${opts.name}\` fetches a package by name, and npm may give that name to someone else (bun also runs a copy an earlier bunx saved, even with --no-install). Use \`bun run ${bin}\` in the package that depends on it, or node_modules/.bin/${bin}; \the --no-install form is accepted only when node_modules/.bin/${bin} exists.`,
    };
  }

  static inspect(opts: {
    command: string;
    cwd: string | undefined;
    allow: string[];
  }): IRunnerHit[] {
    const hits: IRunnerHit[] = [];
    const parsed = ShellParser.parseChecked({ command: opts.command });

    for (const command of [...parsed.commands, ...parsed.unterminatedHeredocCommands]) {
      const found = RunnerGuard.runnerOf({ command });
      const use = found === undefined ? undefined : RunnerScan.fromWords(found);

      if (use === undefined) {
        continue;
      }

      const name = RunnerScan.refusedName({ use, allow: opts.allow });

      if (name === undefined) {
        continue;
      }

      const isLinked =
        use.hasNoInstall &&
        use.packageName === undefined &&
        RunnerGuard.isLinked({ name, cwd: opts.cwd ?? process.cwd() });

      if (!isLinked) {
        hits.push(RunnerGuard.hitOf({ use, name, isNoInstall: use.hasNoInstall }));
      }
    }

    return hits;
  }
}
