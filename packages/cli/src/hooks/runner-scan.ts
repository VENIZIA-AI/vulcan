/** One command that fetches a package and runs it: `bunx`, `bun x`, `npx`, `npm exec`, `pnpm dlx`, `yarn dlx`. */
export interface IRunnerUse {
  /** The runner as written (`bunx`, `bun x`, `npx`, ...). */
  runner: string;
  /** The first word after the flags: the package or bin the command runs, as written (a version included). */
  name: string;
  /** The package a `-p` or `--package` flag names, as written; the command runs a bin of that package. */
  packageName?: string;
  /** The exact flag `--no-install` stands before the name. */
  hasNoInstall: boolean;
  /** The line the command starts on, from 1 (a continuation joins the lines that follow it). */
  line: number;
}

/** What may stand before a runner for the text to be a command and not a sentence about one. */
const COMMAND_START = /(?:^|[\s&|;(`"':>$])$|(?:^|\s)[@+-]+$/;
const COMMAND_WORDS = /(?:^|\s)(?:sudo|time|exec|env|command|nohup|then|do|else|RUN|CMD|ENTRYPOINT)$/;
const ENVIRONMENT = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=\S*\s+$/;
/** Every runner, then a name or nothing: `bun` may carry flags of its own before `x`. */
const RUNNER =
  /(?<![\w./-])(bunx|bun(?:\s+--?[\w-]+(?:=\S+)?)*\s+x|npx|npm\s+(?:exec|x)|pnpm\s+dlx|yarn\s+dlx)(?![\w.-])/g;
/** `['bun', 'x', 'name']`, the form a script or a test spells a command in. */
const ARRAY_FORM = /\[\s*['"](bunx|npx)['"]\s*,\s*['"]([^'"]+)['"]|\[\s*['"]bun['"]\s*,\s*['"]x['"]\s*,\s*['"]([^'"]+)['"]/g;
/** Flags that take the next word as their value, and so never name the package. */
const VALUE_FLAGS = new Set([
  '-p',
  '--package',
  '--cwd',
  '--env-file',
  '--registry',
  '--config',
  '--tag',
  '--call',
  '-c',
  '--userconfig',
  '--prefix',
  '--shell',
]);
const PACKAGE_FLAGS = new Set(['-p', '--package']);
/** A `@venizia/<name>` package, with a version or a tag after it, if any. */
const SCOPED = /^@venizia\/[\w.-]+(?:@[\w.^~*-]+)?$/;

const bare = (opts: { word: string }): string => opts.word.replace(/^["'`]+|["'`,;:.)\]}]+$/g, '');

/**
 * Finds the commands of a text that run a package fetched by name. One scan serves the tracked-file check and the
 * guard on an agent's command, so the cases of what counts as one are decided, and tested, once.
 */
export class RunnerScan {
  /** `text` with each `\` continuation joined to its line, and the line number each logical line starts on. */
  private static logicalLines(opts: { text: string }): { text: string; line: number }[] {
    const lines = opts.text.split('\n');
    const joined: { text: string; line: number }[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      let text = lines[index];
      const line = index + 1;

      while (/\\\s*$/.test(text) && index + 1 < lines.length) {
        index += 1;
        text = `${text.replace(/\\\s*$/, ' ')}${lines[index]}`;
      }

      joined.push({ text, line });
    }

    return joined;
  }

  /** Whether `before` ends where a command may begin: a line start, a separator, a prompt, a quote, a keyword. */
  private static isCommandPosition(opts: { before: string }): boolean {
    let before = opts.before;

    while (ENVIRONMENT.test(before)) {
      before = before.replace(ENVIRONMENT, ' ');
    }

    const trimmed = before.trimEnd();

    return trimmed === '' || COMMAND_START.test(trimmed) || COMMAND_WORDS.test(trimmed);
  }

  /** The command a runner makes of the words after it (already unquoted, as a parsed line has them); `undefined` when it names no package. */
  static fromWords(opts: { runner: string; words: string[]; line?: number }): IRunnerUse | undefined {
    return RunnerScan.useOf({ runner: opts.runner, words: opts.words, line: opts.line ?? 0 });
  }

  private static useOf(opts: { runner: string; words: string[]; line: number }): IRunnerUse | undefined {
    let hasNoInstall = false;
    let packageName: string | undefined;

    for (let index = 0; index < opts.words.length; index += 1) {
      const word = bare({ word: opts.words[index] });

      if (word === '') {
        continue;
      }

      if (!word.startsWith('-')) {
        return {
          runner: opts.runner,
          name: word,
          ...(packageName === undefined ? {} : { packageName }),
          hasNoInstall,
          line: opts.line,
        };
      }

      const [flag, value] = word.split(/=(.*)/s);

      if (word === '--no-install') {
        hasNoInstall = true;
      } else if (VALUE_FLAGS.has(flag) && value === undefined) {
        index += 1;

        if (PACKAGE_FLAGS.has(flag)) {
          packageName = bare({ word: opts.words[index] ?? '' });
        }
      } else if (PACKAGE_FLAGS.has(flag) && value !== undefined) {
        packageName = bare({ word: value });
      }
    }

    return undefined;
  }

  /** Every command of `text` that runs a package by name, in order. */
  static find(opts: { text: string }): IRunnerUse[] {
    const uses: IRunnerUse[] = [];

    for (const { text, line } of RunnerScan.logicalLines({ text: opts.text })) {
      for (const match of text.matchAll(RUNNER)) {
        const index = match.index ?? 0;

        if (!RunnerScan.isCommandPosition({ before: text.slice(0, index) })) {
          continue;
        }

        const rest = text.slice(index + match[0].length);

        // `bunx` straight into a quote or a backtick is a word in a sentence, not the start of a command
        if (!/^\s+\S/.test(rest)) {
          continue;
        }

        const use = RunnerScan.useOf({
          runner: match[1].replace(/\s+/g, ' '),
          words: rest.trim().split(/\s+/),
          line,
        });

        if (use !== undefined) {
          uses.push(use);
        }
      }

      for (const match of text.matchAll(ARRAY_FORM)) {
        uses.push({
          runner: match[1] ?? 'bun x',
          name: match[2] ?? match[3],
          hasNoInstall: false,
          line,
        });
      }
    }

    return uses;
  }

  /** `shadcn@latest` is `shadcn`; a scoped name keeps its scope. */
  static bareName(opts: { name: string }): string {
    return opts.name.replace(/(?<=.)@[^@]*$/, '');
  }

  /**
   * The name a command runs that a project may not accept, or `undefined`: a `@venizia/*` package passes, and so does a
   * name on the allow-list. A `-p` package decides when there is one: the command runs a bin of that package.
   */
  static refusedName(opts: { use: IRunnerUse; allow: string[] }): string | undefined {
    const name = opts.use.packageName ?? opts.use.name;

    return SCOPED.test(name) || opts.allow.includes(RunnerScan.bareName({ name })) ? undefined : name;
  }
}
