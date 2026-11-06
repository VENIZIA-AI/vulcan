import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { HookConstants } from './common/index.ts';
import { TrustStates } from './common/index.ts';
import type { IHookCommand, IReadOnlyScript, IWriteCheck, IWriteHit } from './common/index.ts';
import { CommandView } from './command-view.ts';
import { HookDecision } from './decision.ts';
import type { IProjectCommandCheck } from './project-guards.ts';
import { ShellParser } from './shell.ts';
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

/** Ordered by how much damage the action does. */
const COMMAND_CHECKS: IWriteCheck[] = [
  {
    rule: 'V-W-03',
    what: 'deploying or hot-applying to a cluster',
    pattern: new RegExp(
      [
        verbAfterOptions({
          program: 'kubectl',
          verbs: ['apply', 'patch', 'delete', 'scale', 'rollout', 'create', 'replace', 'set'],
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
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(
      String.raw`\bcurl\b[^|]*\s(?:-[${CURL_SWITCHES}]*[dFT]|--(?:data|json|form|upload-file)\b)`,
    ),
  },
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(
      String.raw`\bcurl\b[^|]*\s(?:-[${CURL_SWITCHES}]*X\s*|--request(?:=|\s+))['"]?(?:${MUTATING_VERB}|post|put|patch|delete)\b`,
    ),
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
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i,
  },
];

/** How a script file is read: as JavaScript or TypeScript for the script checks, or as shell, command by command. */
class ScriptKinds {
  static readonly CODE = 'code';
  static readonly SHELL = 'shell';
}

type TScriptKind = typeof ScriptKinds.CODE | typeof ScriptKinds.SHELL;

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SHELL_EXTENSIONS = new Set(['.sh', '.bash', '.zsh']);
const CODE_RUNNERS = new Set(['bun', 'node', 'deno']);
const SHELL_RUNNERS = new Set(['bash', 'sh', 'zsh', 'dash']);

/** Runner options whose value is the next word, so that word is not the script. */
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

/** A shell with one of these runs no script file: `-c` runs its text (the parser reads it), `-n` only checks syntax, `-s` reads stdin. */
const SHELL_NO_FILE = /^-[a-zA-Z]*[cns]/;

/** Database clients that read SQL from stdin when no SQL is on the line, and the option that puts it there. */
const SQL_CLIENTS: Record<string, RegExp> = {
  psql: /^(?:-[aAbeEHlnqsStwWxX0-9z]*c|--command(?:=|$))/,
  mysql: /^(?:-e|--execute(?:=|$))/,
  mariadb: /^(?:-e|--execute(?:=|$))/,
};

/** The options that make a database client only print something and read no SQL. */
const SQL_CLIENT_INFO = new Set(['-l', '--list', '-V', '--version', '--help', '-?']);

/** How much of a file over the size limit is read to tell a compiled program (a NUL byte) from a script. */
const SNIFF_BYTES = 4096;

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

/** One file to read: the word, the word after it (for `readOnlyScripts`), and whether a `cd` came first. */
interface IFileTarget {
  word: string;
  kind?: TScriptKind;
  subcommand: string | undefined;
  moved: boolean;
}

/** What reading a script gave: its text, or nothing (missing, a folder, a compiled program), or too much to read. */
interface IScriptRead {
  text: string | undefined;
  isTooLarge: boolean;
}

interface IInspectState {
  depth: number;
  /** The files and package scripts already read for this command line: each is read once. */
  seen: Set<string>;
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
    const hits = WriteGuard.inspectAt({ ...opts, state: { depth: 0, seen: new Set() } });

    return hits.filter(
      (hit, index) =>
        hits.findIndex((other) => other.rule === hit.rule && other.message === hit.message) ===
        index,
    );
  }

  private static inspectAt(opts: IInspectOptions & { state: IInspectState }): IWriteHit[] {
    // The patterns run on what the command runs, not on its text: a heredoc written to a file, the pattern
    // of an `rg` and a commit message are data.
    const view = CommandView.viewOf({ command: opts.command, withMessages: true });
    const { texts } = view;
    const checks: IWriteCheck[] = [
      ...COMMAND_CHECKS,
      ...(opts.extra ?? []).map((check) => ({
        rule: check.rule,
        what: `${check.what} (this project's pattern)`,
        pattern: check.pattern,
      })),
    ];
    const hits: IWriteHit[] = checks
      .filter((check) => texts.some((text) => check.pattern.test(text)))
      .map((check) => ({
        rule: check.rule,
        message: check.what,
      }));

    // Part of the line was not read: never an allow.
    if (view.isOverBudget) {
      hits.push({
        rule: 'V-W-02',
        message:
          'this command line is larger, or nests deeper, than the guard reads, so it could not be checked',
      });
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
    const others = view.commands
      .map((command) => WriteGuard.scriptOf({ command }))
      .filter((target): target is IScriptTarget => target !== undefined)
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

    return hits;
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

  /** The words after a runner that are not options or their values. */
  /** Whether a runner option takes the next word as its value; a shell cluster ending in `o` does (`-euo pipefail`). */
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

  /** The local script a simple command runs: `bun x.js`, `bash x.sh`, `./x`, or a `bun run` name; `undefined` for none. */
  private static scriptOf(opts: { command: ISimpleCommand }): IScriptTarget | undefined {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });

    if (CODE_RUNNERS.has(program)) {
      if (
        WriteGuard.optionsOf({ args }).some((word) => EVAL_OPTIONS.has(word.split('=')[0] ?? ''))
      ) {
        return undefined;
      }

      const [first, second] = WriteGuard.positionalsOf({ args });
      const isRun = first === 'run';
      const word = isRun ? second : first;

      if (
        word === undefined ||
        (!isRun && program !== 'node' && !WriteGuard.isFileWord({ word }))
      ) {
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

    if (SHELL_RUNNERS.has(program)) {
      if (WriteGuard.optionsOf({ args }).some((word) => SHELL_NO_FILE.test(word))) {
        return undefined;
      }

      const [word] = WriteGuard.positionalsOf({ args });

      return word === undefined || WriteGuard.isInstalled({ word })
        ? undefined
        : { word, kind: ScriptKinds.SHELL, isPackageScript: false };
    }

    // `./deploy.sh`, `scripts/deploy`: a path run as a program. An absolute path is an installed program.
    if (
      name.includes('/') &&
      !isAbsolute(name) &&
      !/^[~$]/.test(name) &&
      !WriteGuard.isInstalled({ word: name })
    ) {
      return { word: name, isPackageScript: false };
    }

    return undefined;
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

  /**
   * The text of a regular file; a folder, a pipe and a missing path read as nothing, so nothing is opened that
   * can block. A compiled program (a NUL byte near its start) is not a script and reads as nothing too.
   */
  private static readScript(opts: { path: string }): IScriptRead {
    if (!existsSync(opts.path) || !statSync(opts.path).isFile()) {
      return { text: undefined, isTooLarge: false };
    }

    if (statSync(opts.path).size > HookConstants.MAX_SCRIPT_BYTES) {
      return { text: undefined, isTooLarge: !WriteGuard.isCompiled({ path: opts.path }) };
    }

    const text = readFileSync(opts.path, 'utf8');

    return { text: text.includes('\0') ? undefined : text, isTooLarge: false };
  }

  private static isCompiled(opts: { path: string }): boolean {
    const head = Buffer.alloc(SNIFF_BYTES);
    const descriptor = openSync(opts.path, 'r');

    try {
      const read = readSync(descriptor, head, 0, SNIFF_BYTES, 0);

      return head.subarray(0, read).includes(0);
    } finally {
      closeSync(descriptor);
    }
  }

  /** One script file a command runs: the script checks on code, the command checks on shell, one level deeper. */
  private static inspectFile(
    opts: IInspectOptions & { state: IInspectState; file: IFileTarget; entries: IReadOnlyScript[] },
  ): IWriteHit[] {
    const { file } = opts;
    const target = file.word;
    const paths = scriptPathsOf({ target, cwd: opts.cwd });
    const reads = paths.map((path) => WriteGuard.readScript({ path }));

    if (reads.some((read) => read.isTooLarge)) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} is larger than the guard reads, so it could not be checked`,
        },
      ];
    }

    const sources = reads
      .map((read) => read.text)
      .filter((text): text is string => text !== undefined);

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

    const key = ScriptPaths.physicalOf({ path: paths[0] ?? target });

    if (opts.state.seen.has(key)) {
      return [];
    }

    opts.state.seen.add(key);

    const note =
      trust === undefined
        ? ''
        : ` (listed in guard.writes.trustedScripts, but not trusted: ${trust.reason})`;
    const hits: IWriteHit[] = [];

    for (const text of sources) {
      if (WriteGuard.kindOf({ word: target, kind: file.kind, text }) === ScriptKinds.CODE) {
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
    const manifest = WriteGuard.nearestPackageJson({ cwd: opts.cwd });

    if (manifest === undefined) {
      return [];
    }

    const label = `bun run ${opts.name}`;
    const scripts = WriteGuard.scriptsOf({ manifest });

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

    return [`pre${opts.name}`, opts.name, `post${opts.name}`].flatMap((name) => {
      const script = holder.value[name];
      const key = `${manifest}#${name}`;

      if (typeof script !== 'string' || opts.state.seen.has(key)) {
        return [];
      }

      opts.state.seen.add(key);

      return WriteGuard.inspectNested({ ...opts, command: script, cwd: dirname(manifest), label });
    });
  }

  /** The `scripts` field of a package.json, `null` when it has none; `undefined` when the file cannot be read. */
  private static scriptsOf(opts: { manifest: string }): unknown {
    const read = WriteGuard.readScript({ path: opts.manifest });

    if (read.text === undefined) {
      return undefined;
    }

    try {
      const holder = { value: JSON.parse(read.text) };

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
      state: { depth: opts.state.depth + 1, seen: opts.state.seen },
    }).map((hit) => ({
      rule: hit.rule,
      message: `${opts.label} runs what looks like ${hit.message}`,
    }));
  }

  /** The package.json `bun run` reads: the first one in `cwd` or a folder above it. */
  private static nearestPackageJson(opts: { cwd: string }): string | undefined {
    for (let folder = resolve(opts.cwd); ; folder = dirname(folder)) {
      const manifest = join(folder, 'package.json');

      if (existsSync(manifest)) {
        return manifest;
      }

      if (dirname(folder) === folder) {
        return undefined;
      }
    }
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

  static buildDecision(opts: { hits: IWriteHit[] }) {
    return HookDecision.forHost({
      output: {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          permissionDecision: HookConstants.GUARD_DECISION,
          permissionDecisionReason: [
            `This command looks like ${opts.hits.length === 1 ? 'an action' : 'actions'} the base rules reserve for a human:`,
            ...opts.hits.map((hit) => `  - ${hit.rule}: ${hit.message}`),
            '',
            'The rules reject "it is only dev", "it is only a test row" and "it is reversible".',
            'Produce the script, the SQL or the manifest and hand it over instead of running it.',
          ].join('\n'),
        },
      },
    });
  }
}
