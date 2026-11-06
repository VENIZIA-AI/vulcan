import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { TConstValue } from '../common/types.ts';
import { HookConstants } from './common/index.ts';
import { TrustStates } from './common/index.ts';
import type { IHookCommand, IReadOnlyScript, IWriteCheck, IWriteHit } from './common/index.ts';
import { CommandView } from './command-view.ts';
import { HookDecision } from './decision.ts';
import type { IProjectCommandCheck } from './project-guards.ts';
import { ShellModes, ShellParser, ShellPrograms, ShellUnread } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { ReadOnlyScripts, ScriptPaths, ScriptTrust } from './trusted-scripts.ts';

const MUTATING_VERB = '(?:POST|PUT|PATCH|DELETE)';

/** The options a program takes before its verb (`kubectl -n prod apply`), each with or without a value. */
const OPTIONS = String.raw`(?:\s+-\S+(?:\s+[^\s-]\S*)?)*`;

/** A verb ends at a blank, a quote or an operator, so `set` is not `set-context`. */
const VERB_END = String.raw`(?=[\s"';|&)]|$)`;

/** A program name starts a word: `ssh` is not `sh`, `deploy.sh` is not `sh`. */
const PROGRAM_START = String.raw`(?:^|[^\w.-])`;

/** curl's short options that take no value: in a cluster such as `-sd x`, the letters before the one that does. */
const CURL_SWITCHES = '0-9:#aBfgGhiIjJklLMnNOpqRsSvVZ';

const verbAfterOptions = (opts: { program: string; verbs: string[] }): string =>
  `${PROGRAM_START}${opts.program}${OPTIONS}\\s+(?:${opts.verbs.join('|')})${VERB_END}`;

const COMPOSE_VERBS = ['up', 'down', 'restart'];

/** `kubectl rollout status` and `rollout history` only read; every other `rollout` changes the cluster. */
const KUBECTL_ROLLOUT = `rollout(?!${OPTIONS}\\s+(?:status|history)${VERB_END})`;

/** A request body sent with `-d` or `--data*`. With `-G` (`--get`) curl sends that data in the URL of a GET. */
const CURL_DATA_CHECK: IWriteCheck = {
  rule: 'V-W-02',
  what: 'calling an endpoint that mutates data',
  pattern: new RegExp(String.raw`\bcurl\b[^|]*\s(?:-[${CURL_SWITCHES}]*d|--data\b)`),
};

/** Ordered by how much damage the action does. */
const COMMAND_CHECKS: IWriteCheck[] = [
  {
    rule: 'V-W-03',
    what: 'deploying or hot-applying to a cluster',
    pattern: new RegExp(
      [
        verbAfterOptions({
          program: 'kubectl',
          verbs: ['apply', 'patch', 'delete', 'scale', KUBECTL_ROLLOUT, 'create', 'replace', 'set'],
        }),
        verbAfterOptions({ program: `docker${OPTIONS}\\s+compose`, verbs: COMPOSE_VERBS }),
        verbAfterOptions({ program: 'docker-compose', verbs: COMPOSE_VERBS }),
        verbAfterOptions({
          program: 'helm',
          verbs: ['upgrade', 'install', 'rollback', 'uninstall', 'delete'],
        }),
        verbAfterOptions({ program: String.raw`\.\/kc`, verbs: ['apply', 'patch', 'delete'] }),
      ].join('|'),
    ),
  },
  {
    rule: 'V-W-02',
    what: 'running a migration instead of handing it to the human',
    pattern:
      /\bdb:migrate\b|\bmigrate:(dev|local|alpha|develop)\b|drizzle-kit\s+(push|migrate)\b|make\s+db-migrate\b|\bprisma\s+(?:migrate\s+(?:deploy|dev|reset)|db\s+(?:push|execute))\b/,
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern:
      /\b(psql|mysql|mongosh|sqlite3)\b[^|]*?\b(insert|update|delete|truncate|drop|alter|create|grant|revoke)\s|\bmongosh\b[^|]*?\.(?:insert|update|delete|remove|replace|drop|bulkWrite|findOneAnd|findAndModify|createCollection|createIndex|renameCollection)\w*\s*\(/i,
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database through a SQL file whose contents this check cannot see',
    pattern: /\b(psql|mysql)\b[^|]*\s-f\s|\bpsql\b[^|]*\s(?:-[aAbeEHlnqsStwWxX0-9z]*f|--file\b)/,
  },
  CURL_DATA_CHECK,
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(
      String.raw`\bcurl\b[^|]*\s(?:-[${CURL_SWITCHES}]*[FT]|--(?:json|form|upload-file)\b)`,
    ),
  },
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(
      String.raw`\bcurl\b[^|]*\s(?:-[${CURL_SWITCHES}]*X\s*|--request(?:=|\s+))['"]?(?:${MUTATING_VERB}|post|put|patch|delete)\b`,
    ),
  },
  {
    rule: 'V-W-02',
    what: 'calling an endpoint with options read from a file this check cannot see',
    pattern: new RegExp(String.raw`\bcurl\b[^|]*\s(?:-[${CURL_SWITCHES}]*K|--config\b)`),
  },
];

/** A local script hides its real work inside the file, so the file is read too; so is the text of `-e`. */
const SCRIPT_CHECKS: IWriteCheck[] = [
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(
      [
        `method\\s*:\\s*['"\`]${MUTATING_VERB}['"\`]`,
        '\\.(?:post|put|patch|delete)\\s*\\(',
        `['"\`]${MUTATING_VERB}['"\`]\\s*,\\s*['"\`]/`,
      ].join('|'),
      'i',
    ),
  },
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(`^(?=[\\s\\S]*\\bfetch\\s*\\()[\\s\\S]*['"\`]${MUTATING_VERB}['"\`]`, 'i'),
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern:
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i,
  },
  // `truncate` is a common word in code: it counts as SQL in the shape of a statement, with `TABLE`, in upper
  // case, or as a whole string (`'truncate users'`, `"truncate users cascade"`).
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern: /\bTRUNCATE\s+(?:ONLY\s+)?["`]?[A-Za-z_][\w.]*/,
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern: /['"`]\s*truncate\s+(?:only\s+)?["\w.]+\s*(?:['"`;]|(?:cascade|restart|continue)\b)/i,
  },
];

/** How a script file is read: as JavaScript or TypeScript for the script checks, or as shell, command by command. */
class ScriptKinds {
  static readonly CODE = 'code';
  static readonly SHELL = 'shell';
  /** A `package.json` script, read as shell; a key of the visited set, never the kind of a file. */
  static readonly PACKAGE = 'package';
}

type TScriptKind = typeof ScriptKinds.CODE | typeof ScriptKinds.SHELL;

/** What reading a script file gave. */
class ReadStates {
  static readonly TEXT = 'text';
  /** Missing, a folder, a pipe, or a compiled program: there is no script to read. */
  static readonly NONE = 'none';
  static readonly TOO_LARGE = 'too-large';
  /** The file could not be opened, or is not text. */
  static readonly UNREADABLE = 'unreadable';
}

type TReadState = TConstValue<typeof ReadStates>;

/** The first bytes of a compiled program: ELF, Mach-O in both byte orders, a fat Mach-O; and PE, by its two marks. */
class CompiledFormats {
  static readonly MAGIC_NUMBERS: readonly Buffer[] = [
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  ];
  static readonly MAGIC_BYTES = 4;
  static readonly PE_STUB = Buffer.from('MZ');
  static readonly PE_OFFSET_AT = 0x3c;
  static readonly PE_SIGNATURE = Buffer.from([0x50, 0x45, 0, 0]);
}

/** What one call of the guard reads at most, scripts and `package.json` files together; past any of it the command asks. */
class WriteBudget {
  static readonly MAX_BYTES = 4 * HookConstants.MAX_SCRIPT_BYTES;
  /** The characters of every command line and script read as shell. */
  static readonly MAX_CHARS = 1_000_000;
  static readonly MAX_FILES = 100;
  static readonly MAX_MILLISECONDS = 2000;
}

/** The covered tools for which `--help`, `-h` or a `--dry-run` make a call that changes nothing. */
class InertCalls {
  static readonly PROGRAMS = new Set([
    'kubectl',
    'kc',
    'helm',
    'docker',
    'docker-compose',
    'curl',
    'drizzle-kit',
    'prisma',
  ]);
  static readonly HELP = new Set(['--help', '-h']);
  static readonly DRY_RUN = '--dry-run';
  /** `kubectl --dry-run=none` runs for real. */
  static readonly LIVE_DRY_RUNS = new Set(['none', 'false']);
  /** `-G` and `--get`, alone or in a cluster of curl's switches (`-sG`). */
  static readonly CURL_GET = new RegExp(`^(?:--get$|-[${CURL_SWITCHES}]*G)`);
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SHELL_EXTENSIONS = new Set(['.sh', '.bash', '.zsh']);
const CODE_RUNNERS = new Set(['bun', 'node', 'deno']);
const SHELL_RUNNERS = new Set(ShellPrograms.SHELL_NAMES);

/** The builtins that run a file in the current shell. */
const SOURCE_COMMANDS = new Set(['source', '.']);

/** The options of `bun`, `node` and `deno` whose value is the next word, so that word is not the script. */
const RUNNER_VALUE_OPTIONS = new Set([
  '-r',
  '--require',
  '--preload',
  '--import',
  '--loader',
  '--experimental-loader',
  '-C',
  '--conditions',
  '--cwd',
  '--env-file',
  '--config',
  '--filter',
  '-o',
  '--rcfile',
  '--init-file',
  '-e',
  '--eval',
  '-p',
  '--print',
]);

/** The options that make `bun`, `node` and `deno` run the next word as code. */
const EVAL_OPTIONS = new Set(['-e', '--eval', '-p', '--print']);

/** Database clients that read SQL from stdin when no SQL is on the line, and the option that puts it there. */
const SQL_CLIENTS: Record<string, RegExp> = {
  psql: /^(?:-[aAbeEHlnqsStwWxX0-9z]*c|--command(?:=|$))/,
  mysql: /^(?:-e|--execute(?:=|$))/,
  mariadb: /^(?:-e|--execute(?:=|$))/,
};

/** The options that make a database client only print something and read no SQL. */
const SQL_CLIENT_INFO = new Set(['-l', '--list', '-V', '--version', '--help', '-?']);

const UNSEEN_INPUT =
  'running shell commands that come from a pipe or the terminal, which this check cannot see';
const UNSEEN_PRINTED = 'running commands that another command prints, which this check cannot see';

const extractScriptTargets = (opts: { command: string }): string[] =>
  [...opts.command.matchAll(/\bbun\s+(?:run\s+)?(\S+\.ts)\b/g)].map((match) => match[1]);

/**
 * The files a script word can mean. `bun x.ts` opens the path as the OS does, following a link before a `..`;
 * `bun run x.ts` folds the `..` as text first. Both are read, so neither spelling hides the other.
 */
const scriptPathsOf = (opts: { target: string; cwd: string }): string[] => [
  ...new Set([ScriptPaths.targetPath(opts), resolve(opts.cwd, opts.target)]),
];

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** A script file a command runs, or a `bun run` name that the nearest package.json resolves. */
interface IScriptTarget {
  word: string;
  /** The runner says how to read it (`bash x`); `undefined` leaves it to the extension and the first line. */
  kind?: TScriptKind;
  isPackageScript: boolean;
}

/**
 * Where the code a simple command runs comes from: script files, shell text the line shows (`echo ... | sh`),
 * or, in `unseen`, the reason the guard cannot see it.
 */
interface ICodeSource {
  targets: IScriptTarget[];
  texts: string[];
  /** The command the texts are fed to, for the reason of a hit. */
  label: string;
  unseen?: string;
}

/** What a command prints, when the line shows it: the files `cat` prints, the words `echo` prints. */
interface IPrinted {
  targets: IScriptTarget[];
  texts: string[];
}

/** One file to read: the word, the word after it (for `readOnlyScripts`), and whether a `cd` came first. */
interface IFileTarget {
  word: string;
  kind?: TScriptKind;
  subcommand: string | undefined;
  moved: boolean;
}

interface IScriptRead {
  state: TReadState;
  /** Set when `state` is `TEXT`: the file's text, a NUL byte read as a blank. */
  text?: string;
}

/** The work of one call of the guard, shared by every level of scripts it reads. */
interface IInspectWork {
  /** The files (by path and kind) and package scripts already read: each is read once. */
  seen: Set<string>;
  /** Each file is read from disk once, by path. */
  reads: Map<string, IScriptRead>;
  /** The `scripts` of each package.json, parsed once, by path. */
  manifests: Map<string, unknown>;
  /** The package.json nearest each folder. */
  nearest: Map<string, string | undefined>;
  spent: { bytes: number; chars: number; files: number };
  /** `performance.now()` past which the guard reads nothing more. */
  deadline: number;
  isOver: boolean;
}

interface IInspectState {
  depth: number;
  work: IInspectWork;
}

interface IInspectOptions {
  command: string;
  cwd: string;
  trust?: { root: string; scripts: string[]; readOnlyScripts?: IReadOnlyScript[] };
  /** The project's own commands (`guard.writes.commands`), checked beside the fixed list. */
  extra?: IProjectCommandCheck[];
}

export class WriteGuard {
  /**
   * Every reason `command` looks like a write the base rules reserve for a human (V-W-02, V-W-03).
   * `trust` lists the scripts the project vouches for (`guard.writes.trustedScripts`, repo-relative, under
   * `root`): a listed script that is tracked and identical to HEAD skips the script checks only. The checks
   * on the command line itself always run, and a listed script that git says changed is checked like any other.
   * `trust.readOnlyScripts` (`guard.writes.trustedScripts` objects, from the manifest) skips them for one call: the
   * word right after the script is one of the entry's `readOnly` words and the script is tracked and equals HEAD.
   */
  static inspectCommand(opts: IInspectOptions): IWriteHit[] {
    const work: IInspectWork = {
      seen: new Set(),
      reads: new Map(),
      manifests: new Map(),
      nearest: new Map(),
      spent: { bytes: 0, chars: 0, files: 0 },
      deadline: performance.now() + WriteBudget.MAX_MILLISECONDS,
      isOver: false,
    };
    const hits = WriteGuard.inspectAt({ ...opts, state: { depth: 0, work } });

    // Part of the work was not done: never an allow. First, so the reason shows it.
    if (work.isOver) {
      hits.unshift({
        rule: 'V-W-02',
        message:
          'the command runs more scripts, or larger ones, than the guard reads in one call, so it could not be checked',
      });
    }

    const keys = new Set<string>();

    return hits.filter((hit) => {
      const key = `${hit.rule}\n${hit.message}`;

      if (keys.has(key)) {
        return false;
      }

      keys.add(key);

      return true;
    });
  }

  /** Whether the work of this call is over its budget; once it is, it stays over. */
  private static isSpent(opts: { work: IInspectWork }): boolean {
    const { work } = opts;

    work.isOver ||=
      work.spent.bytes > WriteBudget.MAX_BYTES ||
      work.spent.chars > WriteBudget.MAX_CHARS ||
      work.spent.files > WriteBudget.MAX_FILES ||
      performance.now() > work.deadline;

    return work.isOver;
  }

  private static inspectAt(opts: IInspectOptions & { state: IInspectState }): IWriteHit[] {
    const { work } = opts.state;

    work.spent.chars += opts.command.length;

    if (WriteGuard.isSpent({ work })) {
      return [];
    }

    // The patterns run on what the command runs, not on its text: a heredoc written to a file, the pattern
    // of an `rg` and a commit message are data.
    const view = CommandView.viewOf({ command: opts.command, withMessages: true });
    const { texts } = view;
    const fixed = COMMAND_CHECKS.filter((check) =>
      texts.some(
        (text, index) =>
          WriteGuard.isCheckedOn({ check, command: view.sources[index] }) &&
          check.pattern.test(text),
      ),
    );
    const project = (opts.extra ?? [])
      .map((check) => ({
        rule: check.rule,
        what: `${check.what} (this project's pattern)`,
        pattern: check.pattern,
      }))
      .filter((check) => texts.some((text) => check.pattern.test(text)));
    const hits: IWriteHit[] = [...fixed, ...project].map((check) => ({
      rule: check.rule,
      message: check.what,
    }));

    // Part of the line was not read: never an allow. A program that is a substitution is read below, by what it prints.
    const unread = ShellUnread.reasonOf({
      ...view,
      hasUnknownProgram: view.commands.some(
        (command) =>
          ShellParser.isUnknownProgram({ command }) &&
          WriteGuard.substitutionOf({ word: ShellParser.programOf({ command }).name }) ===
            undefined,
      ),
    });

    if (unread !== undefined) {
      hits.push({ rule: 'V-W-02', message: unread });
    }

    for (const command of view.commands) {
      hits.push(
        ...WriteGuard.inspectSqlInput({ command }),
        ...WriteGuard.inspectInline({ command }),
      );
    }

    const targets = extractScriptTargets({ command: texts.join('\n') });
    const entries = opts.trust?.readOnlyScripts ?? [];
    // A subcommand counts only when the shell's own words give the same scripts in the same order as the text
    // does; any other line (a script named in an argument, a pipe into a runner) is read as a whole.
    const invocations = ReadOnlyScripts.extractInvocations({ command: opts.command });
    const isPaired =
      invocations.length === targets.length &&
      invocations.every((invocation, index) => invocation.script === targets[index]);
    const hasMoving = texts.some((text) =>
      ShellParser.parse({ command: text }).some((command) =>
        ReadOnlyScripts.MOVING_COMMANDS.has(
          ShellParser.basenameOf({ word: ShellParser.programOf({ command }).name }),
        ),
      ),
    );
    const sources = view.commands.map((command) => WriteGuard.codeOf({ command }));

    for (const source of sources) {
      if (source.unseen !== undefined) {
        hits.push({ rule: 'V-W-02', message: source.unseen });
      }
    }

    const others = sources
      .flatMap((source) => source.targets)
      .filter((target) => !targets.includes(target.word));
    const files: IFileTarget[] = [
      ...targets.map((word, index): IFileTarget => ({
        word,
        kind: ScriptKinds.CODE,
        subcommand: isPaired ? invocations[index]?.subcommand : undefined,
        moved: isPaired ? invocations[index]?.moved === true : hasMoving,
      })),
      ...others
        .filter((target) => !target.isPackageScript)
        .map((target): IFileTarget => ({
          word: target.word,
          kind: target.kind,
          subcommand: undefined,
          moved: hasMoving,
        })),
    ];

    for (const file of files) {
      hits.push(...WriteGuard.inspectFile({ ...opts, file, entries }));
    }

    for (const target of others.filter((other) => other.isPackageScript)) {
      hits.push(...WriteGuard.inspectPackageScript({ ...opts, name: target.word }));
    }

    for (const source of sources) {
      for (const text of source.texts) {
        hits.push(
          ...WriteGuard.inspectNested({
            ...opts,
            command: text,
            label: `the text fed to ${source.label}`,
          }),
        );
      }
    }

    return hits;
  }

  /**
   * Whether a fixed check applies to the text of `command`: not to a call of a covered tool that only prints
   * its help or runs dry, and the request-body check not to a `curl -G`. A whole line (no command) always counts.
   */
  private static isCheckedOn(opts: {
    check: IWriteCheck;
    command: ISimpleCommand | undefined;
  }): boolean {
    if (opts.command === undefined) {
      return true;
    }

    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });
    const isInert =
      InertCalls.PROGRAMS.has(program) &&
      args.some(
        (word) =>
          InertCalls.HELP.has(word) ||
          word === InertCalls.DRY_RUN ||
          (word.startsWith(`${InertCalls.DRY_RUN}=`) &&
            !InertCalls.LIVE_DRY_RUNS.has(word.slice(InertCalls.DRY_RUN.length + 1))),
      );

    if (isInert) {
      return false;
    }

    return !(
      opts.check === CURL_DATA_CHECK &&
      program === 'curl' &&
      args.some((word) => InertCalls.CURL_GET.test(word))
    );
  }

  /** A database client fed SQL the line does not show: from a pipe, a `<` file or the terminal. */
  private static inspectSqlInput(opts: { command: ISimpleCommand }): IWriteHit[] {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const inline = SQL_CLIENTS[ShellParser.basenameOf({ word: name })];

    if (
      inline === undefined ||
      opts.command.heredoc !== undefined ||
      args.some((word) => inline.test(word) || SQL_CLIENT_INFO.has(word))
    ) {
      return [];
    }

    return [
      {
        rule: 'V-W-02',
        message:
          'writing to a database through SQL that comes from a pipe or a file, which this check cannot see',
      },
    ];
  }

  /** The code `bun -e`, `node --eval` and `deno eval` run, and the heredoc a runner reads, through the script checks. */
  private static inspectInline(opts: { command: ISimpleCommand }): IWriteHit[] {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });

    if (!CODE_RUNNERS.has(program)) {
      return [];
    }

    const evaluated = args.flatMap((word, index) => {
      if (EVAL_OPTIONS.has(word)) {
        return args.slice(index + 1, index + 2);
      }

      const at = word.indexOf('=');

      return at > 0 && EVAL_OPTIONS.has(word.slice(0, at)) ? [word.slice(at + 1)] : [];
    });
    const texts = [
      ...evaluated,
      ...(program === 'deno' && args[0] === 'eval' ? args.slice(1) : []),
      ...(opts.command.heredoc === undefined ? [] : [opts.command.heredoc]),
    ];

    return SCRIPT_CHECKS.filter((check) => texts.some((text) => check.pattern.test(text))).map(
      (check) => ({
        rule: check.rule,
        message: `the inline script looks like it is ${check.what}`,
      }),
    );
  }

  /** Whether an option of `bun`, `node` or `deno` takes the next word as its value. */
  private static takesValue(opts: { word: string }): boolean {
    return RUNNER_VALUE_OPTIONS.has(opts.word) || /^-[a-zA-Z]*[oO]$/.test(opts.word);
  }

  /** The options of a runner itself: the option words before its first positional word (the script's own come after). */
  private static optionsOf(opts: { args: string[] }): string[] {
    const words: string[] = [];

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index];

      if (!word.startsWith('-')) {
        return words;
      }

      words.push(word);
      index += WriteGuard.takesValue({ word }) ? 1 : 0;
    }

    return words;
  }

  /** The words after a runner that are not options or their values. */
  private static positionalsOf(opts: { args: string[] }): string[] {
    const words: string[] = [];

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index];

      if (word.startsWith('-')) {
        index += WriteGuard.takesValue({ word }) ? 1 : 0;
        continue;
      }

      words.push(word);
    }

    return words;
  }

  /**
   * The code a simple command runs, when it is local: `bun x.js`, `bash x.sh`, `source x`, `./x`, a `bun run`
   * name, the file `cat` feeds a shell, or the text `echo` feeds it. A shell whose commands come from where the
   * line does not show, and a program that is the output of another command, are `unseen`.
   */
  private static codeOf(opts: { command: ISimpleCommand }): ICodeSource {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });
    const none: ICodeSource = { targets: [], texts: [], label: program };
    const printed = WriteGuard.substitutionOf({ word: name });

    // `$(cat x)` as a program: what it prints runs.
    if (printed !== undefined) {
      return WriteGuard.fromPrinted({ text: printed, label: program });
    }

    if (CODE_RUNNERS.has(program)) {
      const target = WriteGuard.codeTargetOf({ program, args });

      return { ...none, targets: target === undefined ? [] : [target] };
    }

    if (SHELL_RUNNERS.has(program)) {
      const call = ShellParser.shellCallOf({ args });

      switch (call.mode) {
        case ShellModes.FILE: {
          return WriteGuard.fileCodeOf({ word: call.word, label: program });
        }
        case ShellModes.STDIN: {
          return WriteGuard.inputCodeOf({ command: opts.command, label: program });
        }
        default: {
          // `-c` text is read by the parser as commands of the line; `-n` runs nothing.
          return none;
        }
      }
    }

    if (SOURCE_COMMANDS.has(name)) {
      return WriteGuard.fileCodeOf({ word: args[0], label: name });
    }

    // `./deploy.sh`, `scripts/deploy`: a path run as a program. An absolute path is an installed program.
    if (
      name.includes('/') &&
      !isAbsolute(name) &&
      !/^[~$]/.test(name) &&
      !WriteGuard.isInstalled({ word: name })
    ) {
      return { ...none, targets: [{ word: name, isPackageScript: false }] };
    }

    return none;
  }

  /** The script `bun`, `node` or `deno` runs, or the `bun run` name; `undefined` for none. */
  private static codeTargetOf(opts: {
    program: string;
    args: string[];
  }): IScriptTarget | undefined {
    const { program, args } = opts;

    if (WriteGuard.optionsOf({ args }).some((word) => EVAL_OPTIONS.has(word.split('=')[0] ?? ''))) {
      return undefined;
    }

    const [first, second] = WriteGuard.positionalsOf({ args });
    const isRun = first === 'run';
    const word = isRun ? second : first;

    if (word === undefined || (!isRun && program !== 'node' && !WriteGuard.isFileWord({ word }))) {
      return undefined;
    }

    if (WriteGuard.isInstalled({ word })) {
      return undefined;
    }

    return {
      word,
      kind: SHELL_EXTENSIONS.has(extname(word)) ? ScriptKinds.SHELL : ScriptKinds.CODE,
      isPackageScript: program === 'bun' && isRun && !WriteGuard.isFileWord({ word }),
    };
  }

  /** A file a shell runs (`bash x`, `source x`); a `<(cat x)` word is what `cat` prints. */
  private static fileCodeOf(opts: { word: string | undefined; label: string }): ICodeSource {
    const { word, label } = opts;

    if (word === undefined || WriteGuard.isInstalled({ word })) {
      return { targets: [], texts: [], label };
    }

    const printed = WriteGuard.substitutionOf({ word });

    if (printed !== undefined) {
      return WriteGuard.fromPrinted({ text: printed, label });
    }

    return { targets: [WriteGuard.shellTarget({ word })], texts: [], label };
  }

  /** The commands a shell reads from its standard input: `< file`, a heredoc, a here-string, or what a pipe feeds it. */
  private static inputCodeOf(opts: { command: ISimpleCommand; label: string }): ICodeSource {
    const { input } = opts.command;
    const { label } = opts;

    if (input === undefined) {
      return { targets: [], texts: [], label, unseen: UNSEEN_INPUT };
    }

    const targets = input.files.map((word) => WriteGuard.shellTarget({ word }));
    const texts = [...input.texts];

    if (input.pipedFrom === undefined) {
      return { targets, texts, label };
    }

    const fed = WriteGuard.printedBy({ command: input.pipedFrom });

    if (fed === undefined) {
      return { targets, texts, label, unseen: UNSEEN_INPUT };
    }

    return { targets: [...targets, ...fed.targets], texts: [...texts, ...fed.texts], label };
  }

  /** The text of `$(...)`, of a backtick substitution or of `<(...)` when the word is only that; else `undefined`. */
  private static substitutionOf(opts: { word: string }): string | undefined {
    const match = /^(?:\$\(([\s\S]*)\)|`([\s\S]*)`|<\(([\s\S]*)\))$/.exec(opts.word);

    return match === null ? undefined : (match[1] ?? match[2] ?? match[3]);
  }

  /** The code a substitution prints and something runs: the files of a lone `cat`, the words of a lone `echo`. */
  private static fromPrinted(opts: { text: string; label: string }): ICodeSource {
    const commands = ShellParser.parse({ command: opts.text });
    const [only] = commands;
    const fed =
      commands.length === 1 && only !== undefined && only.input === undefined
        ? WriteGuard.printedBy({ command: only })
        : undefined;

    if (fed === undefined) {
      return { targets: [], texts: [], label: opts.label, unseen: UNSEEN_PRINTED };
    }

    return { targets: fed.targets, texts: fed.texts, label: opts.label };
  }

  /**
   * What `command` prints, when the line shows it: the files `cat` prints, or the words of `echo` and `printf`
   * when they hold no variable, substitution or escape. `undefined` for any other command.
   */
  private static printedBy(opts: { command: ISimpleCommand }): IPrinted | undefined {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });

    if (program === 'cat') {
      const files = args.filter((word) => !word.startsWith('-'));

      return files.length === 0 || opts.command.input !== undefined
        ? undefined
        : { targets: files.map((word) => WriteGuard.shellTarget({ word })), texts: [] };
    }

    if (program !== 'echo' && program !== 'printf') {
      return undefined;
    }

    const words = program === 'echo' ? args.filter((word) => !/^-[neE]+$/.test(word)) : args;
    const text = words.join(' ');

    if (/[$`\\]/.test(text) || (program === 'printf' && text.includes('%'))) {
      return undefined;
    }

    return { targets: [], texts: [text] };
  }

  private static shellTarget(opts: { word: string }): IScriptTarget {
    return { word: opts.word, kind: ScriptKinds.SHELL, isPackageScript: false };
  }

  /** Whether a script word names an installed tool under `node_modules`, not the project's own script. */
  private static isInstalled(opts: { word: string }): boolean {
    return opts.word.split('/').includes('node_modules');
  }

  /** Whether a runner's word names a file (`x.js`, `./x`) rather than a package.json script or a subcommand. */
  private static isFileWord(opts: { word: string }): boolean {
    const extension = extname(opts.word);

    return (
      opts.word.includes('/') || CODE_EXTENSIONS.has(extension) || SHELL_EXTENSIONS.has(extension)
    );
  }

  /** How to read a script: as the runner said, else by its extension, else by its `#!` line. */
  private static kindOf(opts: { word: string; kind?: TScriptKind; text: string }): TScriptKind {
    const extension = extname(opts.word);

    if (opts.kind !== undefined) {
      return opts.kind;
    }

    if (CODE_EXTENSIONS.has(extension)) {
      return ScriptKinds.CODE;
    }

    if (SHELL_EXTENSIONS.has(extension)) {
      return ScriptKinds.SHELL;
    }

    return /^#!.*\b(?:node|bun|deno)\b/.test(opts.text.split('\n')[0] ?? '')
      ? ScriptKinds.CODE
      : ScriptKinds.SHELL;
  }

  /** A file read once per call: the first read is kept and counted against the budget. */
  private static readOnce(opts: { path: string; work: IInspectWork }): IScriptRead {
    const cached = opts.work.reads.get(opts.path);

    if (cached !== undefined) {
      return cached;
    }

    const read = WriteGuard.readScript({ path: opts.path });

    opts.work.spent.files += 1;
    opts.work.spent.bytes += read.text?.length ?? 0;
    opts.work.reads.set(opts.path, read);

    return read;
  }

  /**
   * The text of a regular file; a folder, a pipe and a missing path read as nothing, so nothing is opened that
   * can block. A compiled program (known by its first bytes) is not a script and reads as nothing too. A file
   * that cannot be opened or is not UTF-8 text is unreadable; a NUL byte in a text file reads as a blank.
   */
  private static readScript(opts: { path: string }): IScriptRead {
    if (!existsSync(opts.path)) {
      return { state: ReadStates.NONE };
    }

    try {
      const stat = statSync(opts.path);

      if (!stat.isFile() || WriteGuard.isCompiled({ path: opts.path })) {
        return { state: ReadStates.NONE };
      }

      if (stat.size > HookConstants.MAX_SCRIPT_BYTES) {
        return { state: ReadStates.TOO_LARGE };
      }

      const bytes = readFileSync(opts.path);

      for (let index = bytes.indexOf(0); index !== -1; index = bytes.indexOf(0, index + 1)) {
        bytes[index] = 0x20;
      }

      return {
        state: ReadStates.TEXT,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      };
    } catch (error) {
      console.error(
        `[WriteGuard.readScript] unreadable script | ${opts.path} | ${error instanceof Error ? error.message : String(error)}`,
      );

      return { state: ReadStates.UNREADABLE };
    }
  }

  private static isCompiled(opts: { path: string }): boolean {
    const head = Buffer.alloc(CompiledFormats.MAGIC_BYTES);
    const descriptor = openSync(opts.path, 'r');

    try {
      const read = readSync(descriptor, head, 0, CompiledFormats.MAGIC_BYTES, 0);

      if (
        CompiledFormats.MAGIC_NUMBERS.some(
          (magic) => read >= magic.length && head.subarray(0, magic.length).equals(magic),
        )
      ) {
        return true;
      }

      if (read < 2 || !head.subarray(0, 2).equals(CompiledFormats.PE_STUB)) {
        return false;
      }

      // `MZ` alone also starts a text line (`MZ=prod`): a PE file holds, at the offset stored at 0x3c, `PE\0\0`.
      const offset = Buffer.alloc(4);

      if (readSync(descriptor, offset, 0, 4, CompiledFormats.PE_OFFSET_AT) < 4) {
        return false;
      }

      const signature = Buffer.alloc(CompiledFormats.PE_SIGNATURE.length);
      const signatureRead = readSync(
        descriptor,
        signature,
        0,
        signature.length,
        offset.readUInt32LE(0),
      );

      return signatureRead === signature.length && signature.equals(CompiledFormats.PE_SIGNATURE);
    } finally {
      closeSync(descriptor);
    }
  }

  /** One script file a command runs: the script checks on code, the command checks on shell, one level deeper. */
  private static inspectFile(
    opts: IInspectOptions & { state: IInspectState; file: IFileTarget; entries: IReadOnlyScript[] },
  ): IWriteHit[] {
    const { work } = opts.state;

    if (WriteGuard.isSpent({ work })) {
      return [];
    }

    const { file } = opts;
    const target = file.word;
    const paths = scriptPathsOf({ target, cwd: opts.cwd });
    const reads = paths.map((path) => ({ path, read: WriteGuard.readOnce({ path, work }) }));

    if (reads.some((entry) => entry.read.state === ReadStates.TOO_LARGE)) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} is larger than the guard reads, so it could not be checked`,
        },
      ];
    }

    if (reads.some((entry) => entry.read.state === ReadStates.UNREADABLE)) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} could not be read as text, so it could not be checked`,
        },
      ];
    }

    const sources = reads.flatMap((entry) =>
      entry.read.text === undefined ? [] : [{ path: entry.path, text: entry.read.text }],
    );

    if (sources.length === 0) {
      return [];
    }

    // After a `cd` the hook does not know the folder a relative script word is from, so no entry covers it.
    const isFromUnknownFolder = !isAbsolute(target) && file.moved;
    // An entry covers the word only when both spellings of it (see `scriptPathsOf`) name that same entry.
    const covered = (lookup: (spelling: { target: string }) => string | undefined) => {
      const asWritten = lookup({ target });

      return asWritten === lookup({ target: resolve(opts.cwd, target) }) ? asWritten : undefined;
    };
    const trusted = opts.trust;
    const { subcommand } = file;
    const listed =
      trusted === undefined || isFromUnknownFolder
        ? undefined
        : (covered((spelling) =>
            ScriptTrust.listedOf({
              target: spelling.target,
              cwd: opts.cwd,
              root: trusted.root,
              scripts: trusted.scripts,
            }),
          ) ??
          (subcommand === undefined
            ? undefined
            : covered((spelling) =>
                ReadOnlyScripts.find({
                  target: spelling.target,
                  subcommand,
                  cwd: opts.cwd,
                  root: trusted.root,
                  entries: opts.entries,
                }),
              )));
    const trust =
      listed === undefined || opts.trust === undefined
        ? undefined
        : ScriptTrust.trustOf({ root: opts.trust.root, script: listed });

    if (trust?.state === TrustStates.TRUSTED) {
      return [];
    }

    const note =
      trust === undefined
        ? ''
        : ` (listed in guard.writes.trustedScripts, but not trusted: ${trust.reason})`;
    const hits: IWriteHit[] = [];

    for (const source of sources) {
      const { text } = source;
      const kind = WriteGuard.kindOf({ word: target, kind: file.kind, text });
      // A file read as code is still read as shell when a shell runs it, and the other way round.
      const key = `${kind}:${ScriptPaths.physicalOf({ path: source.path })}`;

      if (work.seen.has(key)) {
        continue;
      }

      work.seen.add(key);

      if (kind === ScriptKinds.CODE) {
        hits.push(
          ...SCRIPT_CHECKS.filter((check) => check.pattern.test(text)).map((check) => ({
            rule: check.rule,
            message: `${target} looks like it is ${check.what}${note}`,
          })),
        );
        continue;
      }

      hits.push(
        ...WriteGuard.inspectNested({ ...opts, command: text, label: target }).map((hit) => ({
          rule: hit.rule,
          message: `${hit.message}${note}`,
        })),
      );
    }

    return hits;
  }

  /** `bun run <name>`: the script of the nearest package.json, its `pre` and `post` scripts with it, read as shell. */
  private static inspectPackageScript(
    opts: IInspectOptions & { state: IInspectState; name: string },
  ): IWriteHit[] {
    const { work } = opts.state;

    if (WriteGuard.isSpent({ work })) {
      return [];
    }

    const manifest = WriteGuard.nearestPackageJson({ cwd: opts.cwd, work });

    if (manifest === undefined) {
      return [];
    }

    const keyOf = (name: string): string => `${ScriptKinds.PACKAGE}:${manifest}#${name}`;
    // The visited set first: a name already read costs no parse.
    const names = [`pre${opts.name}`, opts.name, `post${opts.name}`].filter(
      (name) => !work.seen.has(keyOf(name)),
    );

    if (names.length === 0) {
      return [];
    }

    const label = `bun run ${opts.name}`;
    const scripts = WriteGuard.scriptsOf({ manifest, work });

    if (scripts === undefined) {
      return [
        {
          rule: 'V-W-02',
          message: `${label}: ${manifest} could not be read, so the script could not be checked`,
        },
      ];
    }

    const holder = { value: scripts };

    if (!isRecord(holder)) {
      return [];
    }

    return names.flatMap((name) => {
      const script = holder.value[name];
      const key = keyOf(name);

      if (typeof script !== 'string' || work.seen.has(key)) {
        return [];
      }

      work.seen.add(key);

      return WriteGuard.inspectNested({ ...opts, command: script, cwd: dirname(manifest), label });
    });
  }

  /**
   * The `scripts` field of a package.json, `null` when it has none; `undefined` when the file cannot be read.
   * Each file is parsed once per call.
   */
  private static scriptsOf(opts: { manifest: string; work: IInspectWork }): unknown {
    if (opts.work.manifests.has(opts.manifest)) {
      return opts.work.manifests.get(opts.manifest);
    }

    const scripts = WriteGuard.parseScripts({
      manifest: opts.manifest,
      read: WriteGuard.readOnce({ path: opts.manifest, work: opts.work }),
    });

    opts.work.manifests.set(opts.manifest, scripts);

    return scripts;
  }

  private static parseScripts(opts: { manifest: string; read: IScriptRead }): unknown {
    if (opts.read.text === undefined) {
      return undefined;
    }

    try {
      const holder = { value: JSON.parse(opts.read.text) };

      return isRecord(holder) ? (holder.value['scripts'] ?? null) : null;
    } catch (error) {
      console.error(
        `[WriteGuard.scriptsOf] unreadable package.json | ${opts.manifest} | ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }
  }

  /** The command checks on a script one level deeper; past `MAX_SCRIPT_DEPTH` the guard asks instead of reading on. */
  private static inspectNested(
    opts: IInspectOptions & { state: IInspectState; label: string },
  ): IWriteHit[] {
    if (opts.state.depth >= HookConstants.MAX_SCRIPT_DEPTH) {
      return [
        {
          rule: 'V-W-02',
          message: `${opts.label} runs scripts nested deeper than the guard reads, so it could not be checked`,
        },
      ];
    }

    return WriteGuard.inspectAt({
      command: opts.command,
      cwd: opts.cwd,
      trust: opts.trust,
      extra: opts.extra,
      state: { depth: opts.state.depth + 1, work: opts.state.work },
    }).map((hit) => ({
      rule: hit.rule,
      message: `${opts.label} runs what looks like ${hit.message}`,
    }));
  }

  /** The package.json `bun run` reads: the first one in `cwd` or a folder above it, looked up once per folder. */
  private static nearestPackageJson(opts: { cwd: string; work: IInspectWork }): string | undefined {
    const start = resolve(opts.cwd);

    if (opts.work.nearest.has(start)) {
      return opts.work.nearest.get(start);
    }

    let found: string | undefined;

    for (let folder = start; ; folder = dirname(folder)) {
      const manifest = join(folder, 'package.json');

      if (existsSync(manifest)) {
        found = manifest;
        break;
      }

      if (dirname(folder) === folder) {
        break;
      }
    }

    opts.work.nearest.set(start, found);

    return found;
  }

  /** The Bash command and cwd from the hook's JSON; `undefined` when it is not what Claude Code sends. */
  static parseHookCommand(opts: { text: string }): IHookCommand | undefined {
    let payload: unknown;

    try {
      payload = JSON.parse(opts.text);
    } catch (error) {
      console.error(
        `[WriteGuard.parseHookCommand] unreadable hook input - letting the command through | ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }

    const holder = { value: payload };

    if (!isRecord(holder)) {
      return undefined;
    }

    // The wire names are snake_case; they stay behind string-literal access here, at the boundary (V-C-14).
    const toolInput = { value: holder.value['tool_input'] };
    const command = isRecord(toolInput) ? toolInput.value['command'] : undefined;
    const cwd = holder.value['cwd'];

    return typeof command === 'string' && command !== ''
      ? { command, cwd: typeof cwd === 'string' ? cwd : undefined }
      : undefined;
  }

  /** The hits the reason lists; a line that runs many scripts can find hundreds. */
  private static readonly MAX_LISTED_HITS = 20;

  static buildDecision(opts: { hits: IWriteHit[] }) {
    const listed = opts.hits.slice(0, WriteGuard.MAX_LISTED_HITS);
    const unlisted = opts.hits.length - listed.length;

    return HookDecision.forHost({
      output: {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          permissionDecision: HookConstants.GUARD_DECISION,
          permissionDecisionReason: [
            `This command looks like ${opts.hits.length === 1 ? 'an action' : 'actions'} the base rules reserve for a human:`,
            ...listed.map((hit) => `  - ${hit.rule}: ${hit.message}`),
            ...(unlisted > 0 ? [`  - and ${unlisted} more`] : []),
            '',
            'The rules reject "it is only dev", "it is only a test row" and "it is reversible".',
            'Produce the script, the SQL or the manifest and hand it over instead of running it.',
          ].join('\n'),
        },
      },
    });
  }
}
