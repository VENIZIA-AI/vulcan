import { PackageRunners } from './package-runners.ts';
import type { IRunnerCall } from './package-runners.ts';

/** One command that fetches a package and runs it: `bunx`, `bun x`, `npx`, `npm exec`, `pnpm dlx`, `yarn dlx`, `pnpx`. */
export interface IRunnerUse {
  /** The runner as written (`bunx`, `bun x`, `npx`, ...). */
  runner: string;
  /** The first word after the flags: the package or bin the command runs, as written (a version included); empty when none is given (`xargs bunx`). */
  name: string;
  /** The package a `-p` or `--package` flag names, as written; the command runs a bin of that package. */
  packageName?: string;
  /** The exact flag `--no-install` stands before the name. */
  hasNoInstall: boolean;
  /** Every flag on the way to the name, and the flags before the runner's subcommand (`bun --cwd other x`). */
  flags: string[];
  /** The line the command starts on, from 1 (a continuation joins the lines that follow it). */
  line: number;
  /** The command runs a command string in a shell (`npx -c`), and no package is named: nothing is fetched by name. */
  runsCommand: boolean;
  /** The line is marked as an example (`<!-- runners: example -->`) in a Markdown file. */
  isExample: boolean;
}

/** What may stand before a runner for the text to be a command and not a sentence about one. */
const COMMAND_START = /(?:^|[\s&|;(`"':>$=])$|(?:^|\s)[@+-]+$/;
const COMMAND_WORDS =
  /(?:^|\s)(?:sudo|time|exec|env|command|nohup|then|do|else|RUN|CMD|ENTRYPOINT)$/;
const ENVIRONMENT = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=\S*\s+$/;
/** Every program that may start a runner command; `PackageRunners.find` decides whether the words after it make one. */
const PROGRAM = /(?<![\w./-])(bunx|pnpx|npx|bun|npm|pnpm|yarn|corepack)(?![\w.-])/g;
/** An array of quoted words, the form a script or a test spells a command in. */
const ARRAY_FORM = /\[\s*(['"][^'"]*['"](?:\s*,\s*['"][^'"]*['"])*)/g;
const QUOTED = /['"]([^'"]*)['"]/g;
/** A comment that marks the line or the fenced block after it as an example of a command that is refused (Markdown only). */
const EXAMPLE_MARKER = /^\s*<!--\s*runners:\s*example\s*-->\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** A version, a tag or a range: no `:` (so no `npm:` or `github:` alias), no `/`. */
const VERSION = '[\\w.^~*<>=+-]+';
/** `@scope/name`, any scope, with a version, or a shell placeholder for one (the pinned form of a workflow). */
const SCOPED = new RegExp(`^@[a-z0-9][\\w.-]*/[\\w.-]+(?:@${VERSION})?$`, 'i');
/** The same, with the pinned form of a workflow: `$(...)` or `${...}` after the `@`. A file may carry it, a typed command may not (a variable could print `npm:<name>`). */
const SCOPED_PINNED = new RegExp(
  `^@[a-z0-9][\\w.-]*/[\\w.-]+(?:@(?:${VERSION}|\\$\\(.*|\\$\\{.*))?$`,
  'i',
);
const SPEC_VERSION = new RegExp(`^${VERSION}$`);

/**
 * Finds the commands of a text that run a package fetched by name. One scan serves the tracked-file check and the
 * guard on an agent's command, so the cases of what counts as one are decided, and tested, once.
 */
export class RunnerScan {
  /** `text` with each `\` continuation joined to its line, and the line number each logical line starts on. */
  private static logicalLines(opts: {
    text: string;
  }): { text: string; line: number; end: number }[] {
    const lines = opts.text.split('\n');
    const joined: { text: string; line: number; end: number }[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      let text = lines[index];
      const line = index + 1;

      while (/\\\s*$/.test(text) && index + 1 < lines.length) {
        index += 1;
        text = `${text.replace(/\\\s*$/, ' ')}${lines[index]}`;
      }

      joined.push({ text, line, end: index + 1 });
    }

    return joined;
  }

  /** The lines, from 1, that a marker comment sets apart: the line after it, or the whole fenced block that opens there. */
  private static exampleLines(opts: { text: string }): Set<number> {
    const lines = opts.text.split('\n');
    const marked = new Set<number>();

    for (let index = 0; index < lines.length; index += 1) {
      if (!EXAMPLE_MARKER.test(lines[index] ?? '')) {
        continue;
      }

      const next = index + 1;
      const fence = FENCE.exec(lines[next] ?? '')?.[1];

      if (fence === undefined) {
        marked.add(next + 1);
        continue;
      }

      let end = next + 1;

      while (end < lines.length) {
        const closing = FENCE.exec(lines[end] ?? '')?.[1];

        if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length) {
          break;
        }

        end += 1;
      }

      // a fence that never closes would cover the rest of the file: it counts as no marker
      if (end >= lines.length) {
        continue;
      }

      for (let at = next; at <= end; at += 1) {
        marked.add(at + 1);
      }
    }

    return marked;
  }

  /** Whether `before` ends where a command may begin: a line start, a separator, a prompt, a quote, a keyword. */
  private static isCommandPosition(opts: { before: string }): boolean {
    let before = opts.before;

    while (ENVIRONMENT.test(before)) {
      before = before.replace(ENVIRONMENT, ' ');
    }

    const trimmed = before.trimEnd();

    // a comma right against the program is an argument separator of a make `$(foreach ...)`; a comma and a space is prose
    return (
      trimmed === '' ||
      before.endsWith(',') ||
      COMMAND_START.test(trimmed) ||
      COMMAND_WORDS.test(trimmed)
    );
  }

  /** The command a runner call makes: the package it runs and the flags on the way to it. */
  static useOf(opts: { call: IRunnerCall; line: number; isExample: boolean }): IRunnerUse {
    const target = PackageRunners.targetOf({ words: opts.call.words, runner: opts.call.runner });

    return {
      runner: opts.call.runner,
      name: target.name,
      ...(target.packageName === undefined ? {} : { packageName: target.packageName }),
      hasNoInstall: target.hasNoInstall,
      flags: [...opts.call.leading, ...target.flags],
      runsCommand: target.isCommandString && PackageRunners.COMMAND_RUNNERS.has(opts.call.runner),
      line: opts.line,
      isExample: opts.isExample,
    };
  }

  /** Every command of `text` that runs a package by name, in order. `isMarkdown` lets a marker comment set a line apart as an example. */
  static find(opts: { text: string; isMarkdown?: boolean }): IRunnerUse[] {
    const uses: IRunnerUse[] = [];
    const examples =
      opts.isMarkdown === true ? RunnerScan.exampleLines({ text: opts.text }) : undefined;
    const lines = RunnerScan.logicalLines({ text: opts.text });

    for (const [at, { text, line }] of lines.entries()) {
      const isExample = examples?.has(line) ?? false;

      for (const match of text.matchAll(PROGRAM)) {
        const index = match.index ?? 0;

        if (!RunnerScan.isCommandPosition({ before: text.slice(0, index) })) {
          continue;
        }

        const rest = text.slice(index + match[0].length);

        // `bunx` straight into a quote or a backtick is a word in a sentence, not the start of a command
        if (!/^\s+\S/.test(rest)) {
          continue;
        }

        const words = rest.trim().split(/\s+/);
        let call = PackageRunners.find({ program: match[1], args: words });

        if (call === undefined) {
          continue;
        }

        let use = RunnerScan.useOf({ call, line, isExample });

        // a Markdown wrap can leave the name on the next line, after the flags
        if (use.name === '' && use.packageName === undefined && use.flags.length > 0) {
          const following = lines[at + 1]?.text.trim().split(/\s+/) ?? [];

          call = PackageRunners.find({ program: match[1], args: [...words, ...following] });
          use = call === undefined ? use : RunnerScan.useOf({ call, line, isExample });
        }

        if (
          (use.name !== '' || use.packageName !== undefined) &&
          !RunnerScan.isCommandString({ use })
        ) {
          uses.push(use);
        }
      }

      for (const array of text.matchAll(ARRAY_FORM)) {
        const [program, ...args] = [...(array[1] ?? '').matchAll(QUOTED)].map(
          (word) => word[1] ?? '',
        );
        const call = PackageRunners.find({ program: program ?? '', args });
        const use = call === undefined ? undefined : RunnerScan.useOf({ call, line, isExample });

        if (
          use !== undefined &&
          (use.name !== '' || use.packageName !== undefined) &&
          !RunnerScan.isCommandString({ use })
        ) {
          uses.push(use);
        }
      }
    }

    return uses;
  }

  /** Whether the command runs a command string and names no package: `-c` takes that string, so the word after it is no name. */
  static isCommandString(opts: { use: IRunnerUse }): boolean {
    return opts.use.runsCommand && opts.use.packageName === undefined;
  }

  /** `shadcn@latest` is `shadcn`; a scoped name keeps its scope. */
  static bareName(opts: { name: string }): string {
    return opts.name.replace(/(?<=.)@[^@]*$/, '');
  }

  /**
   * The name a command runs that a project may not accept, or `undefined`. A scoped package (`@scope/name`, any scope: an
   * owner holds it and nobody can register it) passes, and so does a name on the allow-list, with a version or a tag after
   * it and nothing else: `shadcn@npm:tool` and `shadcn@github:owner/repo` are other packages. A `-p` package decides when
   * there is one: the command runs a bin of that package. A command with no name at all is refused (the empty name).
   */
  static refusedName(opts: {
    use: IRunnerUse;
    allow: string[];
    /** True for a tracked file: it may pin a scoped package with `$(...)` or `${...}`. */
    isFile?: boolean;
  }): string | undefined {
    const name = opts.use.packageName ?? opts.use.name;

    if ((opts.isFile === true ? SCOPED_PINNED : SCOPED).test(name)) {
      return undefined;
    }

    const bareName = RunnerScan.bareName({ name });
    const spec = name.slice(bareName.length);
    const isSpecKnown = spec === '' || SPEC_VERSION.test(spec.slice(1));

    return opts.allow.includes(bareName) && isSpecKnown ? undefined : name;
  }
}
