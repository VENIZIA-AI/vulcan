import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TConstValue } from '../common/types.ts';
import { HookConstants } from './common/index.ts';
import { TrustStates } from './common/index.ts';
import type { IHookCommand, IReadOnlyScript, IWriteCheck, IWriteHit } from './common/index.ts';
import { CodeLanguages, CodeText } from './code-text.ts';
import type { ICodeText, TCodeLanguage } from './code-text.ts';
import { CommandView } from './command-view.ts';
import type { ICommandView } from './command-view.ts';
import { HookDecision } from './decision.ts';
import type { IProjectCommandCheck } from './project-guards.ts';
import { PackageManagers } from './package-managers.ts';
import type { IPackageCall } from './package-managers.ts';
import { ScriptRunners } from './script-runners.ts';
import { ShellFolders } from './shell-folders.ts';
import { ShellWrites } from './shell-writes.ts';
import { WriteCommands } from './write-commands.ts';
import type { IShellFolder } from './shell-folders.ts';
import { ShellModes, ShellParser, ShellPrograms, ShellUnread } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { ReadOnlyScripts, ScriptPaths, ScriptTrust } from './trusted-scripts.ts';

const MUTATING_VERB = '(?:POST|PUT|PATCH|DELETE)';

/**
 * A code script hides its real work inside the file, so the file is read too; so is the text of `-e`. A request
 * counts when a client call carries a mutating method: `method: 'POST'` in its options, `axios.post(`, a
 * method then a path (`api('POST', '/x')`), `.request('POST', ...)`.
 */
const REQUEST_CHECK: IWriteCheck = {
  rule: 'V-W-02',
  what: 'calling an endpoint that mutates data',
  pattern: new RegExp(
    [
      `method\\s*:\\s*['"\`]${MUTATING_VERB}['"\`]`,
      String.raw`\b(?:axios|got|ky|superagent|request|requests|httpx|needle|wretch)\s*\.\s*(?:post|put|patch|delete|del)\s*\(`,
      `['"\`]${MUTATING_VERB}['"\`]\\s*,\\s*['"\`]/`,
      `\\.request\\s*\\(\\s*['"\`]${MUTATING_VERB}['"\`]`,
      String.raw`\bNet::HTTP::(?:Post|Put|Patch|Delete)\b`,
    ].join('|'),
    'i',
  ),
};

/** SQL in a string of a code script, in the shape of a statement, all upper case or all lower case. */
const SQL_STRING_CHECKS: IWriteCheck[] = [
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern:
      /(?:^|;)\s*(?:INSERT\s+INTO\s|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|TRUNCATE\s+(?:TABLE\s+|ONLY\s+)?["\w]|DROP\s+(?:TABLE|DATABASE|SCHEMA)\b|ALTER\s+TABLE\s|(?:MERGE|REPLACE)\s+INTO\s)/,
  },
  // `truncate` is a common word: in lower case it counts with `table`, or as a whole statement (`truncate users`).
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern:
      /(?:^|;)\s*(?:insert\s+into\s|update\s+\S+\s+set\s|delete\s+from\s|truncate\s+(?:table\s+\S|(?:only\s+)?["\w.]+\s*(?:;|$|\b(?:cascade|restart|continue)\b))|drop\s+(?:table|database|schema)\b|alter\s+table\s|(?:merge|replace)\s+into\s)/,
  },
];

/**
 * A call that runs a command, its arguments up to the first `)` (strings masked, see `CodeText`): `Bun.spawn`,
 * `child_process`, `execa`, `Deno.Command`, Python's `subprocess`, `os.system` and `os.popen`, and `system`,
 * `popen`, `shell_exec`, `passthru` and `proc_open`.
 * A method of another object (`regex.exec(`) is not one.
 */
const SPAWN_CALL = new RegExp(
  String.raw`(?:\bBun\s*\.\s*spawn(?:Sync)?|\bnew\s+Deno\s*\.\s*Command|\bsubprocess\s*\.\s*(?:run|call|Popen|check_call|check_output)|(?:\bos\s*\.\s*|(?<![\w$.]))(?:system|popen)|(?<![\w$.])(?:shell_exec|passthru|proc_open)|(?:\b(?:child_process|childProcess|cp)\s*\.\s*|(?<![\w$.]))(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|execaSync|execaCommand|execaCommandSync))\s*\(([^)]{0,2000})`,
  'g',
);

/** A tagged template that runs its text as a shell line: `Bun.$\`...\`` and zx's `$\`...\``. */
const SHELL_TAG = /(?:\bBun\s*\.\s*\$|(?<![\w$.])\$)\s*\uE000(\d+)\uE001/g;

/** A string masked by `CodeText`. */
const MASKED_STRING = /\uE000(\d+)\uE001/g;

/** The runners and extensions of scripts with `#` comments. */
const HASH_RUNNERS = new Set(['python', 'python3', 'ruby', 'perl']);
const HASH_EXTENSIONS = new Set(['.py', '.rb', '.pl', '.pm']);

/**
 * A code file a package script names is read only when it looks like an operation: it lives in one of these
 * folders, or its name says so. A plain `bun run dev` of a web app is not read.
 */
class EntryFiles {
  static readonly FOLDERS = new Set(['scripts', 'bin', 'tools', 'ops', 'deploy', 'migrations']);
  static readonly NAME = /deploy|migrate|seed|release|publish|provision|rollout/i;
}

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
  /** Nothing is at the path. */
  static readonly MISSING = 'missing';
  /** A folder, or a compiled program: there is no script to read. */
  static readonly NONE = 'none';
  /** A pipe, a device or a socket: opening it can block, and what it gives cannot be read ahead. */
  static readonly SPECIAL = 'special';
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

const CODE_EXTENSIONS = new Set(ScriptRunners.CODE_EXTENSIONS);
const SHELL_EXTENSIONS = new Set(['.sh', '.bash', '.zsh']);
const SHELL_RUNNERS = new Set(ShellPrograms.SHELL_NAMES);

/** The builtins that run a file in the current shell. */
const SOURCE_COMMANDS = new Set(['source', '.']);

/** Where the project's files end and installed tools begin, for a script word that is an absolute path. */
class ScriptPlaces {
  /** The system folders an installed program lives under. */
  static readonly SYSTEM_PREFIXES = [
    '/usr',
    '/bin',
    '/opt',
    '/nix',
    '/System',
    '/Library',
    '/Applications',
  ];
  /** A folder of installed tools: a program under it is a known tool, whatever its first bytes. */
  static readonly TOOL_FOLDERS = new Set(['bin', 'sbin', 'libexec', 'node_modules']);
}

/**
 * Whether a script word is not a plain path: a variable or a substitution, a glob or brace pattern, or `~`.
 * The guard cannot tell which file such a word names.
 */
const isUnresolvedWord = (opts: { word: string }): boolean => /[$`*?[{]|^~/.test(opts.word);

const UNSEEN_INPUT =
  'running shell commands that come from a pipe or the terminal, which this check cannot see';
const UNSEEN_PRINTED = 'running commands that another command prints, which this check cannot see';
const UNSEEN_STARTUP =
  'a shell startup file (BASH_ENV, ENV, --rcfile) that runs commands this check cannot see';
const UNSEEN_PRELOAD =
  'a library or module loaded into a program (LD_PRELOAD, LD_AUDIT, NODE_OPTIONS --require), which runs code this check cannot see';

/** The variables that make a shell run a file before its own script: `BASH_ENV` for bash, `ENV` for sh. */
const STARTUP_ASSIGNMENT = /^(?:BASH_ENV|ENV)=./;
const STARTUP_NAME = /^(?:BASH_ENV|ENV)$/;
/** The variables that make a program load code of its own before it runs, and a `NODE_OPTIONS` that names a module to load. */
const PRELOAD_ASSIGNMENT = /^(?:LD_PRELOAD|LD_AUDIT|DYLD_INSERT_LIBRARIES)=./;
const NODE_LOADER =
  /^NODE_OPTIONS=(?:.*\s)?(?:-r|--require|--import|--loader|--experimental-loader)(?:[\s=]|$)/;
const PRELOAD_NAME = /^(?:LD_PRELOAD|LD_AUDIT|DYLD_INSERT_LIBRARIES|NODE_OPTIONS)$/;
/** The bash options that name a startup file of their own. */
const RC_OPTION = /^--(?:rcfile|init-file)(?:=|$)/;
const EXPORTING = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);
/** The builtins that give a variable a value or mark it for export, by the name alone (`read NAME`, `export NAME`). */
const SETTING_COMMANDS = new Set([
  ...EXPORTING,
  'read',
  'printf',
  'mapfile',
  'readarray',
  'getopts',
]);
const UNSEEN_FED =
  'running shell text that find, fd or xargs fills in from the files or the input it reads, which this check cannot see';
const UNSEEN_FED_PROGRAM =
  'running a program that find, fd or xargs takes from the files or the input it reads, which this check cannot see';

/** The options that run a command on each result, and the words that end it, per program. */
interface IExecOptions {
  flags: ReadonlySet<string>;
  ends: ReadonlySet<string>;
  /** The option with its command attached (`--exec=cmd`, `-xcmd`): the command is the first group. */
  attached?: RegExp;
}

const FD_EXEC: IExecOptions = {
  flags: new Set(['-x', '--exec', '-X', '--exec-batch']),
  ends: new Set([';']),
  attached: /^(?:--exec(?:-batch)?=|-[xX])(.+)$/s,
};
const EXEC_OPTIONS: Readonly<Record<string, IExecOptions>> = {
  find: {
    flags: new Set(['-exec', '-execdir', '-ok', '-okdir']),
    ends: new Set([';', '+']),
  },
  fd: FD_EXEC,
  fdfind: FD_EXEC,
};

/** The commands `find -exec` and `fd --exec` run, made into commands of their own: they are not words of the line the shell splits. */
const FOUND = new WeakSet<ISimpleCommand>();

/** A `bun x.ts` call anywhere in the text, arguments included: `readOnlyScripts` pairs only a line where each is a call. */
const BUN_TS_MENTION = /\bbun\s+(?:run\s+)?(\S+\.ts)\b/g;

/**
 * The files a script word can mean. `bun x.ts` opens the path as the OS does, following a link before a `..`;
 * `bun run x.ts` folds the `..` as text first. Both are read, so neither spelling hides the other.
 */
const scriptPathsOf = (opts: { target: string; cwd: string }): string[] => [
  ...new Set([ScriptPaths.targetPath(opts), resolve(opts.cwd, opts.target)]),
];

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** A script file a command runs, and the folder its word is taken from. */
interface IScriptTarget {
  word: string;
  /** The runner says how to read it (`bash x`); `undefined` leaves it to the extension and the first line. */
  kind?: TScriptKind;
  /** The program that runs it (`node`, `bun`), for the extensions it adds to a word that names no file. */
  runner?: string;
  folder: string;
}

/** A call of a package manager that runs scripts of a package.json, and the folder it runs in. */
interface IPackageRun {
  call: IPackageCall;
  folder: string;
}

/**
 * Where the code a simple command runs comes from: script files, package scripts, shell text the line shows
 * (`echo ... | sh`), and, in `unseen`, each reason the guard cannot see part of it.
 */
interface ICodeSource {
  targets: IScriptTarget[];
  runs: IPackageRun[];
  texts: string[];
  /** The command the texts are fed to, for the reason of a hit. */
  label: string;
  unseen: string[];
}

/** One file to read: the target, the word after it (for `readOnlyScripts`), and whether a `cd` came first. */
interface IFileTarget extends IScriptTarget {
  subcommand: string | undefined;
  moved: boolean;
}

interface IScriptRead {
  state: TReadState;
  /** Set when `state` is `TEXT`: the file's text, a NUL byte read as a blank. */
  text?: string;
}

/** The packages of a workspace: its root folder and the patterns that list them. */
interface IWorkspace {
  root: string;
  patterns: string[];
}

/** The work of one call of the guard, shared by every level of scripts it reads. */
interface IInspectWork {
  /** The project: an absolute script word outside it is not the project's own. */
  root: string;
  /** The files (by path and kind) and package scripts already read: each is read once. */
  seen: Set<string>;
  /** Each file is read from disk once, by path. */
  reads: Map<string, IScriptRead>;
  /** Each package.json, parsed once, by path; `undefined` when it cannot be read. */
  manifests: Map<string, Record<string, unknown> | undefined>;
  /** The package.json nearest each folder. */
  nearest: Map<string, string | undefined>;
  /** Whether `node_modules/.bin` holds a name, by folder and name. */
  bins: Map<string, boolean>;
  /** The workspace each folder is in, `undefined` for none. */
  workspaces: Map<string, IWorkspace | undefined>;
  spent: { bytes: number; chars: number; files: number };
  /** `performance.now()` past which the guard reads nothing more. */
  deadline: number;
  isOver: boolean;
}

interface IInspectState {
  depth: number;
  work: IInspectWork;
  /** False when the folder the command line runs in is not known (after a `cd` the guard cannot work out). */
  isCwdKnown: boolean;
  /** The line is a package script: a code file it names is read only when it looks like an operation. */
  isPackageScript: boolean;
}

interface IInspectOptions {
  command: string;
  cwd: string;
  trust?: { root: string; scripts: string[]; readOnlyScripts?: IReadOnlyScript[] };
  /** The project's own commands (`guard.writes.commands`), checked beside the fixed list. */
  extra?: IProjectCommandCheck[];
}

const sourceOf = (opts: { label: string }): ICodeSource => ({
  targets: [],
  runs: [],
  texts: [],
  label: opts.label,
  unseen: [],
});

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
      root: ScriptPaths.physicalOf({ path: resolve(opts.trust?.root ?? opts.cwd) }),
      seen: new Set(),
      reads: new Map(),
      manifests: new Map(),
      nearest: new Map(),
      bins: new Map(),
      workspaces: new Map(),
      spent: { bytes: 0, chars: 0, files: 0 },
      deadline: performance.now() + WriteBudget.MAX_MILLISECONDS,
      isOver: false,
    };
    const hits = WriteGuard.inspectAt({
      ...opts,
      state: { depth: 0, work, isCwdKnown: true, isPackageScript: false },
    });

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
    const hits: IWriteHit[] = WriteGuard.commandChecksOf({ view, extra: opts.extra }).map(
      (check) => ({ rule: check.rule, message: check.what }),
    );

    // Part of the line was not read: never an allow. A program that is a substitution is read below, by what it prints.
    const unread = ShellUnread.reasonOf({
      ...view,
      // `${x@P}` runs a substitution wherever it stands, in the argument of an `echo` too: every command counts.
      hasUnknownProgram:
        view.commands.some(
          (command) =>
            ShellParser.isUnknownProgram({ command }) &&
            !WriteGuard.isPrintedFile({ word: ShellParser.programOf({ command }).name }),
        ) || view.parsed.some((command) => ShellParser.hasPromptExpansion({ command })),
    });

    if (unread !== undefined) {
      hits.push({ rule: 'V-W-02', message: unread });
    }

    const commands = view.commands.flatMap((command) => [
      command,
      ...WriteGuard.foundOf({ command }),
    ]);

    // A startup file or a preloaded library counts for every command, a read-only tool included: `LD_PRELOAD=f ls`.
    for (const command of view.parsed) {
      hits.push(...WriteGuard.inspectStartup({ command }));
    }

    for (const command of commands) {
      hits.push(
        ...WriteGuard.inspectFedProgram({ command }),
        ...WriteCommands.inspectClient({ command }),
        ...WriteGuard.inspectInline({ command, extra: opts.extra, work }),
      );
    }

    const entries = opts.trust?.readOnlyScripts ?? [];
    const invocations = ReadOnlyScripts.extractInvocations({ command: opts.command });
    const hasMoving = texts.some((text) =>
      ShellParser.parse({ command: text }).some((command) =>
        ReadOnlyScripts.MOVING_COMMANDS.has(
          ShellParser.basenameOf({ word: ShellParser.programOf({ command }).name }),
        ),
      ),
    );
    const cwd = resolve(opts.cwd);
    // Every command counts for the folders, data too: an `echo "$(bash x)"` carries a line that runs.
    const started = ShellFolders.foldersOf({
      commands: view.parsed,
      cwd,
      pwd: opts.state.isCwdKnown ? cwd : undefined,
      isKnown: opts.state.isCwdKnown,
      home: process.env.HOME ?? '',
      env: {},
    });
    const folderOf = new Map(view.parsed.map((command, index) => [command, started[index]]));
    // A script the line itself writes (`> x.sh`, `tee`, `cp`) holds what the line puts there, not what is on disk now.
    const written = new Set(
      view.parsed.flatMap((command, index) => {
        const at = started[index];

        return at === undefined
          ? []
          : ShellWrites.targetsOf({ command, base: at.base, tmp: tmpdir() }).flatMap((target) => {
              const expanded = ShellFolders.expandPath({
                word: target.word,
                home: process.env.HOME ?? '',
                env: {},
                cwd: at.pwd,
              });

              return expanded === undefined
                ? []
                : [ScriptPaths.physicalOf({ path: resolve(target.base, expanded) })];
            });
      }),
    );
    const fallback: IShellFolder = { base: cwd, pwd: cwd, isKnown: opts.state.isCwdKnown };
    const sources = commands.map((command) => {
      const at = folderOf.get(command) ?? folderOf.get(command.carrier ?? command) ?? fallback;

      return { ...WriteGuard.codeOf({ command, at, root: work.root }), at };
    });

    for (const source of sources) {
      for (const message of source.unseen) {
        hits.push({ rule: 'V-W-02', message });
      }
    }

    const targets = sources
      .flatMap((source) => source.targets)
      .filter(
        (target) =>
          !opts.state.isPackageScript || WriteGuard.isOperationFile({ target, root: work.root }),
      );
    // A `bun x.ts` call counts for `readOnlyScripts` only when the shell's own words give the same scripts in the
    // same order; any other line (a script named in an argument, a pipe into a runner) is read as a whole.
    const calls = targets.filter(
      (target) => target.runner === 'bun' && target.word.endsWith('.ts'),
    );
    const mentioned = [...texts.join('\n').matchAll(BUN_TS_MENTION)].map((match) => match[1]);
    const isPaired =
      invocations.length === calls.length &&
      mentioned.length === calls.length &&
      invocations.every(
        (invocation, index) =>
          invocation.script === calls[index]?.word && invocation.script === mentioned[index],
      );
    const files = targets.map((target): IFileTarget => {
      const at = calls.indexOf(target);
      const invocation = isPaired && at !== -1 ? invocations[at] : undefined;
      const isMoved = invocation === undefined ? hasMoving : invocation.moved === true;

      return {
        ...target,
        subcommand: invocation?.subcommand,
        moved: isMoved || target.folder !== cwd,
      };
    });

    for (const file of files) {
      hits.push(...WriteGuard.inspectFile({ ...opts, file, entries, written }));
    }

    for (const run of sources.flatMap((source) => source.runs)) {
      hits.push(...WriteGuard.inspectPackageRun({ ...opts, run }));
    }

    for (const source of sources) {
      for (const text of source.texts) {
        hits.push(
          ...WriteGuard.inspectNested({
            ...opts,
            command: text,
            cwd: source.at.base,
            isCwdKnown: source.at.isKnown,
            isPackageScript: opts.state.isPackageScript,
            label: `the text fed to ${source.label}`,
          }),
        );
      }
    }

    return hits;
  }

  /**
   * The table's checks that match what a command line runs, and the project's own patterns. A check of the
   * table does not apply to a call of its program that changes nothing (`--help`, `--dry-run`, `curl -G`); a
   * whole line that pipes into a runner (no command behind it) always counts.
   */
  private static commandChecksOf(opts: {
    view: ICommandView;
    extra: IProjectCommandCheck[] | undefined;
  }): IWriteCheck[] {
    const { texts, sources } = opts.view;
    const fixed = WriteCommands.CHECKS.filter((check) =>
      texts.some((text, index) => {
        const command = sources[index];

        if (command === undefined) {
          return check.pattern.test(text);
        }

        const { program, args } = WriteGuard.callOf({ command });
        const { script } = ScriptRunners.callOf({ program, args });
        // `python manage.py migrate --plan`: the script is the program the row names.
        const named = script === undefined ? program : ShellParser.basenameOf({ word: script });

        return (
          WriteCommands.isLive({ check, program, args }) &&
          WriteCommands.isLive({ check, program: named, args }) &&
          check.pattern.test(text)
        );
      }),
    );
    const project = (opts.extra ?? [])
      .map((check) => ({
        rule: check.rule,
        what: `${check.what} (this project's pattern)`,
        pattern: check.pattern,
      }))
      .filter((check) => texts.some((text) => check.pattern.test(text)));

    return [...fixed, ...project];
  }

  /**
   * What a code script, or the code of an eval option, looks like it does: a request with a mutating method
   * in its code (comments left out), SQL in the shape of a statement in its strings, and the commands it runs
   * (`Bun.spawn`, `child_process`, `Bun.$`, `subprocess`, ...) through the command table.
   */
  private static codeChecksOf(opts: {
    text: string;
    language: TCodeLanguage;
    extra: IProjectCommandCheck[] | undefined;
    work: IInspectWork;
  }): IWriteCheck[] {
    const read = CodeText.readOf({ text: opts.text, language: opts.language });
    const checks: IWriteCheck[] = [];

    if (REQUEST_CHECK.pattern.test(read.code)) {
      checks.push(REQUEST_CHECK);
    }

    checks.push(
      ...SQL_STRING_CHECKS.filter((check) =>
        read.strings.some((string) => check.pattern.test(string.text)),
      ),
    );

    for (const command of WriteGuard.commandsOf({ read, language: opts.language })) {
      opts.work.spent.chars += command.length;

      if (WriteGuard.isSpent({ work: opts.work })) {
        break;
      }

      checks.push(
        ...WriteGuard.commandChecksOf({
          view: CommandView.viewOf({ command, withMessages: true }),
          extra: opts.extra,
        }),
      );
    }

    return checks;
  }

  /**
   * The command lines a code script gives to a call that runs them: the strings among a call's arguments
   * joined by blanks (`spawn('helm', ['upgrade', ...])` is `helm upgrade ...`), the text of a shell tag, and
   * a backtick command of Ruby or Perl. A variable among the arguments is left out.
   */
  private static commandsOf(opts: { read: ICodeText; language: TCodeLanguage }): string[] {
    const { read } = opts;
    const textOf = (index: string | undefined): string => read.strings[Number(index)]?.text ?? '';
    const commands = [
      ...[...read.masked.matchAll(SPAWN_CALL)].map((call) =>
        [...(call[1] ?? '').matchAll(MASKED_STRING)].map((token) => textOf(token[1])).join(' '),
      ),
      ...[...read.masked.matchAll(SHELL_TAG)]
        .filter((tag) => read.strings[Number(tag[1])]?.isBacktick === true)
        .map((tag) => textOf(tag[1])),
      ...(opts.language === CodeLanguages.HASH
        ? read.strings.filter((string) => string.isBacktick).map((string) => string.text)
        : []),
    ];

    return commands.filter((command) => command.trim() !== '');
  }

  /**
   * Whether a package script's target is read: a shell script always; a code file only under one of
   * `EntryFiles.FOLDERS`, or with a name of `EntryFiles.NAME`.
   */
  private static isOperationFile(opts: { target: IScriptTarget; root: string }): boolean {
    const { target } = opts;
    const isCode =
      target.kind === ScriptKinds.CODE ||
      (target.kind === undefined && CODE_EXTENSIONS.has(extname(target.word)));

    if (!isCode) {
      return true;
    }

    const path = ScriptPaths.physicalOf({ path: resolve(target.folder, target.word) });
    const folders = relative(opts.root, path).split(sep).slice(0, -1);

    return (
      folders.some((folder) => EntryFiles.FOLDERS.has(folder)) ||
      EntryFiles.NAME.test(basename(path))
    );
  }

  /** How a script's comments and strings are written: `#` for Python, Ruby and Perl, else JavaScript's. */
  private static languageOf(opts: { word: string; runner?: string }): TCodeLanguage {
    return HASH_EXTENSIONS.has(extname(opts.word)) ||
      (opts.runner !== undefined && HASH_RUNNERS.has(opts.runner))
      ? CodeLanguages.HASH
      : CodeLanguages.C_LIKE;
  }

  /**
   * The code a runner's eval option runs (`bun -e`, `node --eval`, `deno eval`, `python -c`), and the heredoc a
   * runner reads, through the code checks.
   */
  private static inspectInline(opts: {
    command: ISimpleCommand;
    extra: IProjectCommandCheck[] | undefined;
    work: IInspectWork;
  }): IWriteHit[] {
    const { program, args } = WriteGuard.callOf({ command: opts.command });

    if (!Object.hasOwn(ScriptRunners.TABLES, program)) {
      return [];
    }

    const texts = [
      ...ScriptRunners.callOf({ program, args }).evals,
      ...(opts.command.heredoc === undefined ? [] : [opts.command.heredoc]),
    ];
    const language = WriteGuard.languageOf({ word: '', runner: program });

    return texts
      .flatMap((text) =>
        WriteGuard.codeChecksOf({ text, language, extra: opts.extra, work: opts.work }),
      )
      .map((check) => ({
        rule: check.rule,
        message: `the inline script looks like it is ${check.what}`,
      }));
  }

  /**
   * What makes a shell or a program run code the line does not show, set outside the command itself: a startup
   * file (`BASH_ENV=f bash -c x`, `env -u X BASH_ENV=f bash`, `nice env ENV=f sh`, `export BASH_ENV`,
   * `read BASH_ENV`, `bash --rcfile f`) and a preloaded library (`LD_PRELOAD=f.so ls`).
   */
  private static inspectStartup(opts: { command: ISimpleCommand }): IWriteHit[] {
    const { command } = opts;
    const { name, index, args } = ShellParser.programOf({ command });
    const before = index === -1 ? command.words : command.words.slice(0, index);
    const setting = SETTING_COMMANDS.has(name) ? args : [];
    const assigned = [...command.assignments, ...before, ...setting];
    const isShell = SHELL_RUNNERS.has(ShellParser.basenameOf({ word: name }));
    const hits: IWriteHit[] = [];

    if (
      assigned.some((word) => STARTUP_ASSIGNMENT.test(word)) ||
      setting.some((word) => STARTUP_NAME.test(word)) ||
      (isShell && args.some((word) => RC_OPTION.test(word)))
    ) {
      hits.push({ rule: 'V-W-02', message: UNSEEN_STARTUP });
    }

    if (
      assigned.some((word) => PRELOAD_ASSIGNMENT.test(word) || NODE_LOADER.test(word)) ||
      setting.some((word) => PRELOAD_NAME.test(word))
    ) {
      hits.push({ rule: 'V-W-02', message: UNSEEN_PRELOAD });
    }

    return hits;
  }

  /**
   * The commands a `find` runs with `-exec`, `-execdir`, `-ok` or `-okdir`, up to the `;` or `+` that ends each, and
   * the command `fd` runs with `-x`, `--exec`, `-X` or `--exec-batch`.
   */
  private static foundOf(opts: { command: ISimpleCommand }): ISimpleCommand[] {
    const { name } = ShellParser.programOf({ command: opts.command });
    const options = EXEC_OPTIONS[ShellParser.basenameOf({ word: name })];

    if (options === undefined) {
      return [];
    }

    const found: ISimpleCommand[] = [];
    const { words } = opts.command;

    for (let index = 0; index < words.length; index += 1) {
      const attached = options.attached?.exec(words[index] ?? '')?.[1];

      if (!options.flags.has(words[index] ?? '') && attached === undefined) {
        continue;
      }

      const end = words.findIndex((word, at) => at > index && options.ends.has(word));
      const run = [
        ...(attached === undefined ? [] : [attached]),
        ...words.slice(index + 1, end === -1 ? words.length : end),
      ];

      if (run.length > 0) {
        const command: ISimpleCommand = {
          words: run,
          redirects: [],
          assignments: [],
          scope: opts.command.scope,
          carrier: opts.command,
        };

        FOUND.add(command);
        found.push(command);
      }

      index = end === -1 ? words.length : end;
    }

    return found;
  }

  /** What feeds a command: the `xargs` before it, with its replace strings, or the `find` that made it. */
  private static feedOf(opts: {
    command: ISimpleCommand;
  }): { before: string[]; replaces: string[]; isXargs: boolean } | undefined {
    const { command } = opts;
    const { index } = ShellParser.programOf({ command });
    const before = index === -1 ? command.words : command.words.slice(0, index);
    const isXargs = before.some((item) => ShellParser.basenameOf({ word: item }) === 'xargs');

    if (!isXargs && !FOUND.has(command)) {
      return undefined;
    }

    const replaces = ['{}'];

    before.forEach((item, at) => {
      if (item === '-I' || item === '-i') {
        replaces.push(before[at + 1] ?? '');
      } else if (/^-[Ii]./.test(item)) {
        replaces.push(item.slice(2));
      } else if (item.startsWith('--replace=')) {
        replaces.push(item.slice('--replace='.length));
      }
    });

    return { before, replaces, isXargs };
  }

  /**
   * Why the text a shell runs with `-c` is not on the line: `xargs` adds its input to the command or puts it
   * where the replace string is (`xargs -I{} sh -c '{}'`), and `find -exec` puts a file name there.
   */
  private static fedTextOf(opts: {
    command: ISimpleCommand;
    word: string | undefined;
  }): string | undefined {
    const feed = WriteGuard.feedOf({ command: opts.command });

    if (feed === undefined) {
      return undefined;
    }

    return opts.word === undefined ||
      feed.replaces.some((mark) => mark !== '' && opts.word?.includes(mark))
      ? UNSEEN_FED
      : undefined;
  }

  /**
   * A program that comes from the files or the input: the replace string or `{}` as the program word
   * (`find . -exec {} ;`, `xargs -I{} {} apply`), or `xargs` followed by wrappers alone (`xargs -L1 env`, `xargs
   * sudo`): each input line then names the program.
   */
  private static inspectFedProgram(opts: { command: ISimpleCommand }): IWriteHit[] {
    const feed = WriteGuard.feedOf({ command: opts.command });

    if (feed === undefined) {
      return [];
    }

    const { name } = ShellParser.programOf({ command: opts.command });
    const isMarked = feed.replaces.some((mark) => mark !== '' && name.includes(mark));
    const after = opts.command.words.slice(
      opts.command.words.findIndex((word) => ShellParser.basenameOf({ word }) === 'xargs') + 1,
    );
    const isInput =
      feed.isXargs &&
      name === '' &&
      after.some(
        (word) =>
          !word.startsWith('-') &&
          ShellPrograms.WRAPPER_NAMES.includes(ShellParser.basenameOf({ word })),
      );

    return isMarked || isInput ? [{ rule: 'V-W-02', message: UNSEEN_FED_PROGRAM }] : [];
  }

  /** The program a simple command runs, past wrappers (`sudo`, `env`) and launchers (`npx tsx`, `uv run`). */
  private static callOf(opts: { command: ISimpleCommand }): {
    name: string;
    program: string;
    args: string[];
    isPackage: boolean;
  } {
    const launched = ScriptRunners.launchedOf(ShellParser.programOf({ command: opts.command }));

    return { ...launched, program: ShellParser.basenameOf({ word: launched.name }) };
  }

  /**
   * The code a simple command runs, when it is local: `bun x.js`, `bash x.sh`, `source x`, `./x`, a package
   * script (`bun run`, `npm run`, `pnpm`, `yarn`), the file `cat` feeds a shell, or the text `echo` feeds it.
   * What the guard cannot see is `unseen`: a shell fed from where the line does not show, a program that is the
   * output of another command, a script word it cannot resolve, a folder it cannot work out.
   */
  private static codeOf(opts: {
    command: ISimpleCommand;
    at: IShellFolder;
    root: string;
  }): ICodeSource {
    const { name, program, args, isPackage } = WriteGuard.callOf({ command: opts.command });
    const { at } = opts;
    const none = sourceOf({ label: program });
    const printed = WriteGuard.substitutionOf({ word: name });

    // `$(cat x)` as a program: what it prints runs.
    if (printed !== undefined) {
      return WriteGuard.fromPrinted({ text: printed, label: program, at });
    }

    if (PackageManagers.isManager({ program })) {
      return WriteGuard.managerCodeOf({ program, args, at });
    }

    if (Object.hasOwn(ScriptRunners.TABLES, program)) {
      const { script } = ScriptRunners.callOf({ program, args });

      return script === undefined || script === '-'
        ? none
        : WriteGuard.fileCodeOf({
            word: script,
            label: program,
            kind: SHELL_EXTENSIONS.has(extname(script)) ? ScriptKinds.SHELL : ScriptKinds.CODE,
            runner: program,
            at,
          });
    }

    if (SHELL_RUNNERS.has(program)) {
      const call = ShellParser.shellCallOf({ args });

      switch (call.mode) {
        case ShellModes.FILE: {
          return WriteGuard.fileCodeOf({
            word: call.word,
            label: program,
            kind: ScriptKinds.SHELL,
            at,
          });
        }
        case ShellModes.STDIN: {
          return WriteGuard.inputCodeOf({ command: opts.command, label: program, at });
        }
        default: {
          // `-c` text is read by the parser as commands of the line; `-n` runs nothing.
          const fed =
            call.mode === ShellModes.COMMAND
              ? WriteGuard.fedTextOf({ command: opts.command, word: call.word })
              : undefined;

          return fed === undefined ? none : { ...none, unseen: [fed] };
        }
      }
    }

    if (SOURCE_COMMANDS.has(name)) {
      return WriteGuard.fileCodeOf({ word: args[0], label: name, kind: ScriptKinds.SHELL, at });
    }

    // A package `npx` or `bunx` runs (`npx @scope/tool`, `npx user/repo`) is no file of the project.
    if (isPackage) {
      return none;
    }

    // `./deploy.sh`, `scripts/deploy`: a path run as a program. An absolute path outside the project is an
    // installed program; a variable as the program is not followed.
    if (!name.includes('/') || /^[~$]/.test(name) || WriteGuard.isInstalled({ word: name })) {
      return none;
    }

    if (isAbsolute(name) && !WriteGuard.isInside({ path: name, root: opts.root })) {
      return none;
    }

    return { ...none, ...WriteGuard.targetOf({ word: name, label: program, at }) };
  }

  /**
   * What a package manager runs: the scripts it names, in the folder its options or the line give, a file
   * (`bun x.ts`), or shell text (`bun exec`). A name or a folder the guard cannot resolve is `unseen`.
   */
  private static managerCodeOf(opts: {
    program: string;
    args: string[];
    at: IShellFolder;
  }): ICodeSource {
    const { program, at } = opts;
    const none = sourceOf({ label: program });
    const call = PackageManagers.callOf({ manager: program, args: opts.args });

    if (call === undefined) {
      return none;
    }

    if (call.unseen !== undefined) {
      return { ...none, unseen: [call.unseen] };
    }

    if (call.text !== undefined) {
      return { ...none, texts: [call.text] };
    }

    if (call.names.length === 0 && call.file === undefined) {
      return none;
    }

    if (call.folder !== undefined && isUnresolvedWord({ word: call.folder })) {
      return {
        ...none,
        unseen: [`${program} runs in ${call.folder}, a folder the guard cannot work out`],
      };
    }

    if (!at.isKnown && (call.folder === undefined || !isAbsolute(call.folder))) {
      return { ...none, unseen: [`${program} runs from a folder the guard cannot work out`] };
    }

    const folder = call.folder === undefined ? at.base : resolve(at.base, call.folder);
    const callAt: IShellFolder = { base: folder, pwd: folder, isKnown: true };

    if (call.file !== undefined) {
      return WriteGuard.fileCodeOf({
        word: call.file,
        label: program,
        kind: SHELL_EXTENSIONS.has(extname(call.file)) ? ScriptKinds.SHELL : ScriptKinds.CODE,
        runner: program,
        at: callAt,
      });
    }

    const unresolved = call.names.filter(
      (name) => isUnresolvedWord({ word: name }) || /^\/.*\/$/.test(name),
    );

    if (unresolved.length > 0) {
      return {
        ...none,
        unseen: unresolved.map(
          (name) => `${program} runs ${name}, a script name the guard cannot resolve`,
        ),
      };
    }

    return { ...none, runs: [{ call, folder }] };
  }

  /**
   * A script word as a target to read, from the folder it is taken from. A word that is not a plain path, or a
   * relative word in a folder the guard cannot work out, is `unseen`.
   */
  private static targetOf(opts: {
    word: string;
    kind?: TScriptKind;
    runner?: string;
    label: string;
    at: IShellFolder;
  }): Pick<ICodeSource, 'targets' | 'unseen'> {
    const { word, label } = opts;

    if (isUnresolvedWord({ word })) {
      return {
        targets: [],
        unseen: [
          `${label} runs ${word}, a script named by a variable, a substitution or a pattern, which the guard cannot resolve`,
        ],
      };
    }

    if (!isAbsolute(word) && !opts.at.isKnown) {
      return {
        targets: [],
        unseen: [`${label} runs ${word} from a folder the guard cannot work out`],
      };
    }

    return {
      targets: [{ word, kind: opts.kind, runner: opts.runner, folder: opts.at.base }],
      unseen: [],
    };
  }

  /** A file a runner or a shell runs (`node x`, `bash x`, `source x`); a `<(cat x)` word is what `cat` prints. */
  private static fileCodeOf(opts: {
    word: string | undefined;
    label: string;
    kind: TScriptKind;
    runner?: string;
    at: IShellFolder;
  }): ICodeSource {
    const { word, label } = opts;
    const none = sourceOf({ label });

    if (word === undefined || WriteGuard.isInstalled({ word })) {
      return none;
    }

    const printed = word.startsWith('<(') ? WriteGuard.substitutionOf({ word }) : undefined;

    if (printed !== undefined) {
      return WriteGuard.fromPrinted({ text: printed, label, at: opts.at });
    }

    return { ...none, ...WriteGuard.targetOf({ ...opts, word }) };
  }

  /** The commands a shell reads from its standard input: `< file`, a heredoc, a here-string, or what a pipe feeds it. */
  private static inputCodeOf(opts: {
    command: ISimpleCommand;
    label: string;
    at: IShellFolder;
  }): ICodeSource {
    const { input } = opts.command;
    const { label, at } = opts;
    const none = sourceOf({ label });

    if (input === undefined) {
      return { ...none, unseen: [UNSEEN_INPUT] };
    }

    const files = input.files.map((word) =>
      WriteGuard.targetOf({ word, kind: ScriptKinds.SHELL, label, at }),
    );
    const source: ICodeSource = {
      ...none,
      targets: files.flatMap((file) => file.targets),
      texts: [...input.texts],
      unseen: files.flatMap((file) => file.unseen),
    };

    if (input.pipedFrom === undefined) {
      return source;
    }

    const fed = WriteGuard.printedBy({ command: input.pipedFrom, label, at });

    if (fed === undefined) {
      return { ...source, unseen: [...source.unseen, UNSEEN_INPUT] };
    }

    return {
      ...source,
      targets: [...source.targets, ...fed.targets],
      texts: [...source.texts, ...fed.texts],
      unseen: [...source.unseen, ...fed.unseen],
    };
  }

  /** The text of `$(...)`, of a backtick substitution or of `<(...)` when the word is only that; else `undefined`. */
  /** A program word that is a lone `cat FILE` substitution: the files it prints are read as code below. Any other substitution names a program the line does not show. */
  private static isPrintedFile(opts: { word: string }): boolean {
    const text = WriteGuard.substitutionOf({ word: opts.word });

    if (text === undefined) {
      return false;
    }

    const commands = ShellParser.parse({ command: text });
    const [only] = commands;

    return (
      commands.length === 1 &&
      only !== undefined &&
      ShellParser.programOf({ command: only }).name === 'cat'
    );
  }

  private static substitutionOf(opts: { word: string }): string | undefined {
    const match = /^(?:\$\(([\s\S]*)\)|`([\s\S]*)`|<\(([\s\S]*)\))$/.exec(opts.word);

    return match === null ? undefined : (match[1] ?? match[2] ?? match[3]);
  }

  /** The code a substitution prints and something runs: the files of a lone `cat`, the words of a lone `echo`. */
  private static fromPrinted(opts: { text: string; label: string; at: IShellFolder }): ICodeSource {
    const commands = ShellParser.parse({ command: opts.text });
    const [only] = commands;
    const fed =
      commands.length === 1 && only !== undefined && only.input === undefined
        ? WriteGuard.printedBy({ command: only, label: opts.label, at: opts.at })
        : undefined;

    if (fed === undefined) {
      return { ...sourceOf({ label: opts.label }), unseen: [UNSEEN_PRINTED] };
    }

    return { ...sourceOf({ label: opts.label }), ...fed };
  }

  /**
   * What `command` prints, when the line shows it: the files `cat` prints, or the words of `echo` and `printf`
   * when they hold no variable, substitution or escape. `undefined` for any other command.
   */
  private static printedBy(opts: {
    command: ISimpleCommand;
    label: string;
    at: IShellFolder;
  }): Pick<ICodeSource, 'targets' | 'texts' | 'unseen'> | undefined {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });

    if (program === 'cat') {
      const files = args
        .filter((word) => !word.startsWith('-'))
        .map((word) =>
          WriteGuard.targetOf({ word, kind: ScriptKinds.SHELL, label: opts.label, at: opts.at }),
        );

      return files.length === 0 || opts.command.input !== undefined
        ? undefined
        : {
            targets: files.flatMap((file) => file.targets),
            texts: [],
            unseen: files.flatMap((file) => file.unseen),
          };
    }

    if (program !== 'echo' && program !== 'printf') {
      return undefined;
    }

    const words = program === 'echo' ? args.filter((word) => !/^-[neE]+$/.test(word)) : args;
    const text = words.join(' ');

    if (/[$`\\]/.test(text) || (program === 'printf' && text.includes('%'))) {
      return undefined;
    }

    return { targets: [], texts: [text], unseen: [] };
  }

  /** Whether a script word names an installed tool under `node_modules`, not the project's own script. */
  private static isInstalled(opts: { word: string }): boolean {
    return opts.word.split('/').includes('node_modules');
  }

  /** Whether `path`, links followed, is `root` or under it. */
  private static isInside(opts: { path: string; root: string }): boolean {
    const path = ScriptPaths.physicalOf({ path: opts.path });

    return path === opts.root || path.startsWith(`${opts.root}${sep}`);
  }

  /**
   * An absolute script word outside the project: an installed program under a system folder (a compiled one,
   * or one in a folder of tools) is not read; any other asks, since the guard does not read outside the project.
   */
  private static outsideOf(opts: { target: string; work: IInspectWork }): IWriteHit[] {
    const { target } = opts;
    const isSystem = ScriptPlaces.SYSTEM_PREFIXES.some(
      (prefix) => target === prefix || target.startsWith(`${prefix}/`),
    );
    const isTool = target.split('/').some((segment) => ScriptPlaces.TOOL_FOLDERS.has(segment));

    if (isSystem && (isTool || WriteGuard.isCompiledFile({ path: target, work: opts.work }))) {
      return [];
    }

    return [
      {
        rule: 'V-W-02',
        message: `${target} is outside the project, so the guard does not read it`,
      },
    ];
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
   * The text of a regular file. A missing path, a folder and a compiled program (known by its first bytes)
   * read as nothing. A pipe, a device or a socket is never opened, since that can block: it is special. The
   * file is opened without blocking and looked at again, so one swapped in after the first look is caught. A
   * file that cannot be opened or is not UTF-8 text is unreadable; a NUL byte in a text file reads as a blank.
   */
  private static readScript(opts: { path: string }): IScriptRead {
    if (!existsSync(opts.path)) {
      return { state: ReadStates.MISSING };
    }

    let descriptor: number | undefined;

    try {
      const stat = statSync(opts.path);

      if (stat.isDirectory()) {
        return { state: ReadStates.NONE };
      }

      if (!stat.isFile()) {
        return { state: ReadStates.SPECIAL };
      }

      descriptor = openSync(opts.path, constants.O_RDONLY | constants.O_NONBLOCK);

      const opened = fstatSync(descriptor);

      if (!opened.isFile()) {
        return { state: ReadStates.SPECIAL };
      }

      if (WriteGuard.isCompiled({ descriptor })) {
        return { state: ReadStates.NONE };
      }

      if (opened.size > HookConstants.MAX_SCRIPT_BYTES) {
        return { state: ReadStates.TOO_LARGE };
      }

      const bytes = readFileSync(descriptor);

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
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  }

  /** Whether the open file is a compiled program, from its first bytes; reads at offsets, so its position stays. */
  private static isCompiled(opts: { descriptor: number }): boolean {
    const { descriptor } = opts;
    const head = Buffer.alloc(CompiledFormats.MAGIC_BYTES);
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
  }

  /** Whether `path` is a compiled program, from its first bytes; each look counts as a file. */
  private static isCompiledFile(opts: { path: string; work: IInspectWork }): boolean {
    opts.work.spent.files += 1;

    try {
      if (!WriteGuard.isFile({ path: opts.path })) {
        return false;
      }

      const descriptor = openSync(opts.path, constants.O_RDONLY | constants.O_NONBLOCK);

      try {
        return fstatSync(descriptor).isFile() && WriteGuard.isCompiled({ descriptor });
      } finally {
        closeSync(descriptor);
      }
    } catch (error) {
      console.error(
        `[WriteGuard.isCompiledFile] unreadable program | ${opts.path} | ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  /** Whether `path` is a regular file, without opening it. */
  private static isFile(opts: { path: string }): boolean {
    try {
      return statSync(opts.path).isFile();
    } catch {
      return false;
    }
  }

  /**
   * The file a runner opens for a word that names none: `node x` runs `x.js`, `node dir` runs the `main` of
   * `dir/package.json` or `dir/index.js`. The word as written when it names a file, or when nothing matches.
   */
  private static fileWordOf(opts: { file: IScriptTarget; work: IInspectWork }): string {
    const { file } = opts;
    const table = file.runner === undefined ? undefined : ScriptRunners.TABLES[file.runner];
    const path = resolve(file.folder, file.word);

    if (table === undefined || table.extensions.length === 0 || WriteGuard.isFile({ path })) {
      return file.word;
    }

    const withExtensions = (word: string): string[] => [
      word,
      ...table.extensions.map((extension) => `${word}${extension}`),
    ];
    const manifest = join(path, 'package.json');
    const main = WriteGuard.isFile({ path: manifest })
      ? WriteGuard.manifestOf({ manifest, work: opts.work })?.['main']
      : undefined;
    const candidates = [
      ...withExtensions(file.word).slice(1),
      ...(typeof main === 'string' ? withExtensions(join(file.word, main)) : []),
      ...withExtensions(join(file.word, 'index')).slice(1),
    ];

    return (
      candidates.find((word) => WriteGuard.isFile({ path: resolve(file.folder, word) })) ??
      file.word
    );
  }

  /** One script file a command runs: the script checks on code, the command checks on shell, one level deeper. */
  private static inspectFile(
    opts: IInspectOptions & {
      state: IInspectState;
      file: IFileTarget;
      entries: IReadOnlyScript[];
      /** The files the same line writes, by physical path. */
      written?: ReadonlySet<string>;
    },
  ): IWriteHit[] {
    const { work } = opts.state;

    if (WriteGuard.isSpent({ work })) {
      return [];
    }

    const { file } = opts;
    const target = file.word;

    if (isAbsolute(target) && !WriteGuard.isInside({ path: target, root: work.root })) {
      return WriteGuard.outsideOf({ target, work });
    }

    const paths = scriptPathsOf({
      target: WriteGuard.fileWordOf({ file, work }),
      cwd: file.folder,
    });
    const reads = paths.map((path) => ({ path, read: WriteGuard.readOnce({ path, work }) }));

    // The file may be written by an earlier command of the same line: what it will hold cannot be seen.
    if (reads.every((entry) => entry.read.state === ReadStates.MISSING)) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} does not exist yet, so the guard cannot see what it runs`,
        },
      ];
    }

    if (reads.some((entry) => opts.written?.has(ScriptPaths.physicalOf({ path: entry.path })))) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} is written by the same command line, so the guard cannot see what it will run`,
        },
      ];
    }

    if (reads.some((entry) => entry.read.state === ReadStates.TOO_LARGE)) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} is larger than the guard reads, so it could not be checked`,
        },
      ];
    }

    if (reads.some((entry) => entry.read.state === ReadStates.SPECIAL)) {
      return [
        {
          rule: 'V-W-02',
          message: `${target} is not a regular file (a pipe, a device or a socket), so the guard cannot read it`,
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
          ...WriteGuard.codeChecksOf({
            text,
            language: WriteGuard.languageOf({ word: target, runner: file.runner }),
            extra: opts.extra,
            work,
          }).map((check) => ({
            rule: check.rule,
            message: `${target} looks like it is ${check.what}${note}`,
          })),
        );
        continue;
      }

      // A shell script runs in the folder it was started from, not in its own.
      hits.push(
        ...WriteGuard.inspectNested({
          ...opts,
          command: text,
          cwd: file.folder,
          isCwdKnown: true,
          isPackageScript: false,
          label: target,
        }).map((hit) => ({
          rule: hit.rule,
          message: `${hit.message}${note}`,
        })),
      );
    }

    return hits;
  }

  /**
   * A call that runs scripts of a package.json: each name in the package of its folder, or in each workspace
   * package it picks (`--filter`, `--workspace`, `-r`), with their `pre` and `post` scripts, read as shell.
   */
  private static inspectPackageRun(
    opts: IInspectOptions & { state: IInspectState; run: IPackageRun },
  ): IWriteHit[] {
    const { work } = opts.state;
    const { call, folder } = opts.run;

    if (WriteGuard.isSpent({ work })) {
      return [];
    }

    if (call.workspaces === undefined) {
      return WriteGuard.inspectScripts({
        ...opts,
        manifest: WriteGuard.nearestPackageJson({ cwd: folder, work }),
        folder,
        isPicked: false,
      });
    }

    const picked = WriteGuard.packagesOf({
      folder,
      workspaces: call.workspaces,
      work,
    });

    if (typeof picked === 'string') {
      return [
        { rule: 'V-W-02', message: `${call.manager} runs ${call.names.join(' ')}: ${picked}` },
      ];
    }

    return picked.flatMap((dir) =>
      WriteGuard.inspectScripts({
        ...opts,
        manifest: join(dir, 'package.json'),
        folder: dir,
        isPicked: !call.workspaces?.isRoot || call.workspaces.selectors.length > 0,
      }),
    );
  }

  /**
   * The scripts `names` of `manifest`. A name it does not have asks, unless `node_modules/.bin` has it, it is a
   * lifecycle the manager handles itself (`npm test` with no `test`), or the package was picked out of many
   * (`--filter`), where a package without the script is skipped.
   */
  private static inspectScripts(
    opts: IInspectOptions & {
      state: IInspectState;
      run: IPackageRun;
      manifest: string | undefined;
      folder: string;
      isPicked: boolean;
    },
  ): IWriteHit[] {
    const { work } = opts.state;
    const { call } = opts.run;
    const { manifest } = opts;
    const parsed = manifest === undefined ? {} : WriteGuard.manifestOf({ manifest, work });

    if (parsed === undefined) {
      return [
        {
          rule: 'V-W-02',
          message: `${call.manager} run ${call.names.join(' ')}: ${manifest} could not be read, so the script could not be checked`,
        },
      ];
    }

    const holder = { value: parsed['scripts'] };
    const scripts = isRecord(holder) ? holder.value : {};
    const home = manifest === undefined ? opts.folder : dirname(manifest);

    return call.names.flatMap((name) => {
      const label = `${call.manager} run ${name}`;

      if (typeof scripts[name] !== 'string') {
        return WriteGuard.inspectMissingScript({ ...opts, name, label, home });
      }

      const keyOf = (script: string): string => `${ScriptKinds.PACKAGE}:${manifest}#${script}`;

      return [`pre${name}`, name, `post${name}`].flatMap((script) => {
        const text = scripts[script];
        const key = keyOf(script);

        if (typeof text !== 'string' || work.seen.has(key)) {
          return [];
        }

        work.seen.add(key);

        return WriteGuard.inspectNested({
          ...opts,
          command: text,
          cwd: home,
          isCwdKnown: true,
          isPackageScript: true,
          label,
        });
      });
    });
  }

  /** A script name the package.json does not have: what the manager runs instead, or an ask. */
  private static inspectMissingScript(
    opts: IInspectOptions & {
      state: IInspectState;
      run: IPackageRun;
      isPicked: boolean;
      name: string;
      label: string;
      home: string;
    },
  ): IWriteHit[] {
    const { work } = opts.state;
    const { call } = opts.run;
    const { name } = opts;

    if (opts.isPicked) {
      return [];
    }

    // `npm start` with no `start` runs `node server.js`: a code entry file, not read, like any a package script names.
    if (call.isLifecycle) {
      return [];
    }

    if (
      PackageManagers.isBuiltIn({ manager: call.manager, word: name }) ||
      WriteGuard.hasBin({ folder: opts.run.folder, name, work })
    ) {
      return [];
    }

    return [
      {
        rule: 'V-W-02',
        message: `${opts.label}: ${name} is not a script of the package.json nor an installed tool, so the guard cannot tell what it runs`,
      },
    ];
  }

  /** Whether `node_modules/.bin/<name>` is in `folder` or a folder above it; each lookup counts as a file. */
  private static hasBin(opts: { folder: string; name: string; work: IInspectWork }): boolean {
    const key = `${opts.folder}\n${opts.name}`;
    const cached = opts.work.bins.get(key);

    if (cached !== undefined) {
      return cached;
    }

    opts.work.spent.files += 1;

    let found = false;

    for (let folder = resolve(opts.folder); ; folder = dirname(folder)) {
      if (existsSync(join(folder, 'node_modules', '.bin', opts.name))) {
        found = true;
        break;
      }

      if (dirname(folder) === folder) {
        break;
      }
    }

    opts.work.bins.set(key, found);

    return found;
  }

  /**
   * The folders of the workspace packages a call picks, or why the guard cannot tell. Selectors match a
   * package's name (globs as `Bun.Glob` reads them) or its folder; pnpm's graph selectors (`...`, `^`, `{}`,
   * `[]`, `!`) are not followed.
   */
  private static packagesOf(opts: {
    folder: string;
    workspaces: NonNullable<IPackageCall['workspaces']>;
    work: IInspectWork;
  }): string[] | string {
    const { workspaces, work } = opts;
    const workspace = WriteGuard.workspaceOf({ folder: opts.folder, work });

    if (workspace === undefined) {
      return 'it runs in workspace packages, and the guard finds no workspace here';
    }

    if (workspaces.isRoot && workspaces.selectors.length === 0 && !workspaces.isEvery) {
      return [workspace.root];
    }

    const packages = WriteGuard.workspacePackagesOf({ workspace, work });

    if (typeof packages === 'string') {
      return packages;
    }

    if (workspaces.isEvery) {
      return packages.map((entry) => entry.folder);
    }

    const graph = workspaces.selectors.find((selector) => /\.\.\.|[\^{}[\]!=]/.test(selector));

    if (graph !== undefined) {
      return `the guard does not follow the selector ${graph}`;
    }

    const picked = packages.filter((entry) =>
      workspaces.selectors.some(
        (selector) =>
          (entry.name !== undefined && new Bun.Glob(selector).match(entry.name)) ||
          [opts.folder, workspace.root].some((base) =>
            new Bun.Glob(resolve(base, selector)).match(entry.folder),
          ),
      ),
    );

    return picked.length === 0
      ? `${workspaces.selectors.join(' ')} picks no package the guard can find`
      : picked.map((entry) => entry.folder);
  }

  /** The workspace `folder` is in: the nearest folder whose package.json lists `workspaces`, or with a pnpm-workspace.yaml. */
  private static workspaceOf(opts: { folder: string; work: IInspectWork }): IWorkspace | undefined {
    const start = resolve(opts.folder);

    if (opts.work.workspaces.has(start)) {
      return opts.work.workspaces.get(start);
    }

    let found: IWorkspace | undefined;

    for (let folder = start; found === undefined; folder = dirname(folder)) {
      found = WriteGuard.workspaceAt({ folder, work: opts.work });

      if (dirname(folder) === folder) {
        break;
      }
    }

    opts.work.workspaces.set(start, found);

    return found;
  }

  private static workspaceAt(opts: { folder: string; work: IInspectWork }): IWorkspace | undefined {
    const manifest = join(opts.folder, 'package.json');
    const field = WriteGuard.isFile({ path: manifest })
      ? WriteGuard.manifestOf({ manifest, work: opts.work })?.['workspaces']
      : undefined;
    const holder = { value: field };
    const listed = isRecord(holder) ? holder.value['packages'] : field;

    if (Array.isArray(listed)) {
      return {
        root: opts.folder,
        patterns: listed.filter((pattern) => typeof pattern === 'string'),
      };
    }

    const yaml = join(opts.folder, 'pnpm-workspace.yaml');

    if (!WriteGuard.isFile({ path: yaml })) {
      return undefined;
    }

    const text = WriteGuard.readOnce({ path: yaml, work: opts.work }).text ?? '';
    const block = /^packages:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(text)?.[1] ?? '';
    const patterns = [...block.matchAll(/^[ \t]+-[ \t]+['"]?([^'"#\n]+?)['"]?[ \t]*$/gm)].map(
      (match) => match[1] ?? '',
    );

    return { root: opts.folder, patterns };
  }

  /**
   * The packages of a workspace, its root among them: a pattern is a folder, or a folder whose last segment is a
   * glob (`packages/*`). Any other pattern (`**`, a negation) is not expanded, and the guard says so.
   */
  private static workspacePackagesOf(opts: {
    workspace: IWorkspace;
    work: IInspectWork;
  }): { folder: string; name: string | undefined }[] | string {
    const { workspace, work } = opts;
    const folders = new Set([workspace.root]);

    for (const pattern of workspace.patterns) {
      const segments = pattern.replace(/\/+$/, '').split('/');
      const last = segments.at(-1) ?? '';
      const parent = segments.slice(0, -1);

      if (
        pattern.startsWith('!') ||
        parent.some((segment) => /[*?[{]/.test(segment)) ||
        last.includes('**')
      ) {
        return `the workspace pattern ${pattern} is one the guard does not expand`;
      }

      if (!/[*?[{]/.test(last)) {
        folders.add(resolve(workspace.root, pattern));
        continue;
      }

      const base = resolve(workspace.root, ...parent);

      work.spent.files += 1;

      if (WriteGuard.isSpent({ work })) {
        return 'the workspace has more packages than the guard reads in one call';
      }

      const glob = new Bun.Glob(last);

      for (const entry of existsSync(base) ? readdirSync(base, { withFileTypes: true }) : []) {
        if (entry.isDirectory() && glob.match(entry.name)) {
          folders.add(join(base, entry.name));
        }
      }
    }

    return [...folders]
      .filter((folder) => WriteGuard.isFile({ path: join(folder, 'package.json') }))
      .map((folder) => {
        const name = WriteGuard.manifestOf({ manifest: join(folder, 'package.json'), work })?.[
          'name'
        ];

        return { folder, name: typeof name === 'string' ? name : undefined };
      });
  }

  /** A package.json, parsed once per call; `undefined` when it cannot be read, an empty record when it is no object. */
  private static manifestOf(opts: {
    manifest: string;
    work: IInspectWork;
  }): Record<string, unknown> | undefined {
    if (opts.work.manifests.has(opts.manifest)) {
      return opts.work.manifests.get(opts.manifest);
    }

    const parsed = WriteGuard.parseManifest({
      manifest: opts.manifest,
      read: WriteGuard.readOnce({ path: opts.manifest, work: opts.work }),
    });

    opts.work.manifests.set(opts.manifest, parsed);

    return parsed;
  }

  private static parseManifest(opts: {
    manifest: string;
    read: IScriptRead;
  }): Record<string, unknown> | undefined {
    if (opts.read.text === undefined) {
      return undefined;
    }

    try {
      const holder = { value: JSON.parse(opts.read.text) };

      return isRecord(holder) ? holder.value : {};
    } catch (error) {
      console.error(
        `[WriteGuard.manifestOf] unreadable package.json | ${opts.manifest} | ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }
  }

  /** The command checks on a script one level deeper; past `MAX_SCRIPT_DEPTH` the guard asks instead of reading on. */
  private static inspectNested(
    opts: IInspectOptions & {
      state: IInspectState;
      label: string;
      isCwdKnown: boolean;
      /** The text is a package script, or what one feeds a shell. */
      isPackageScript: boolean;
    },
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
      state: {
        depth: opts.state.depth + 1,
        work: opts.state.work,
        isCwdKnown: opts.isCwdKnown,
        isPackageScript: opts.isPackageScript,
      },
    }).map((hit) => ({
      rule: hit.rule,
      message: `${opts.label} runs what looks like ${hit.message}`,
    }));
  }

  /** The package.json a package manager reads: the first one in `cwd` or a folder above it, looked up once per folder. */
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
        `[WriteGuard.parseHookCommand] unreadable hook input | ${error instanceof Error ? error.message : String(error)}`,
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
