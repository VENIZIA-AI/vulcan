import { basename, dirname, join, relative, resolve } from 'node:path';
import { GitRewrite, PatchInput } from './manifest-git.ts';
import { ManifestPath, PathPattern, PathRef } from './manifest-path.ts';
import type { TPathRef } from './manifest-path.ts';
import { InlineScript } from './manifest-script.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

interface ICall {
  program: string;
  args: string[];
  /** Command lines the wrapper carries as text (`flock -c '..'`, `script -c '..'`). */
  nested: string[];
  /** The command is fed by `xargs`. */
  isFed: boolean;
  /** The folder `env -C` / `env --chdir` moves the command to. */
  chdir?: string;
}

interface IRef {
  index: number;
  kind: TPathRef;
}

interface ILine {
  cwd: string | undefined;
  depth: number;
  isAbout: boolean;
  /** The folder the line starts in: a `cd` into an `.agents` folder from outside it makes the rest of the line about it. */
  startDir: string;
  /** How many commands of the line moved the stash stack so far. */
  stashMoves: number;
}

/** What the line sets for the glob and the folder before: read by every word. */
interface IView {
  previous: string | undefined;
  dotglob: boolean;
  globstar: boolean;
}

/**
 * Reads a command line for what it does to the manifest. A command that names the file (or the folder that
 * holds it) is refused unless its program only reads: the readers are listed, everything else is not let
 * through. The programs that copy, move, extract or restore are read by what they put where.
 */
export class ManifestShell {
  static readonly MAX_DEPTH = 4;
  static readonly MAX_FILTERS = 100;
  static readonly READERS = new Set([
    'cat',
    'head',
    'tail',
    'less',
    'more',
    'bat',
    'batcat',
    'jq',
    'yq',
    'diff',
    'diff3',
    'cmp',
    'comm',
    'grep',
    'egrep',
    'fgrep',
    'rg',
    'ag',
    'wc',
    'ls',
    'stat',
    'file',
    'sha1sum',
    'sha224sum',
    'sha256sum',
    'sha384sum',
    'sha512sum',
    'md5sum',
    'b2sum',
    'cksum',
    'shasum',
    'realpath',
    'readlink',
    'test',
    '[',
    '[[',
    'tree',
    'echo',
    'printf',
    'cut',
    'tr',
    'sort',
    'nl',
    'column',
    'od',
    'hexdump',
    'strings',
    'du',
    'paste',
    'fold',
    'fmt',
    'tac',
    'rev',
    'basename',
    'dirname',
    'which',
    'type',
    'true',
    'false',
    'cd',
    'pushd',
    'popd',
    'base64',
    'mkdir',
    'uniq',
    'xxd',
  ]);
  /** Formatters that only report, unless they are told to write. */
  static readonly CHECKERS = new Map<string, string[]>([
    ['prettier', ['--write', '-w']],
    ['biome', ['--write', '--fix', '--apply', '--apply-unsafe']],
    ['eslint', ['--fix', '--fix-dry-run']],
  ]);
  /** Stream editors and scripting filters: readers unless they edit in place. */
  static readonly FILTERS = new Set(['sed', 'awk', 'gawk', 'mawk', 'perl', 'ruby']);
  /** Programs that run a script: a name in their words is not known to be only read. */
  static readonly RUNNERS = new Set([
    'bun',
    'bunx',
    'node',
    'nodejs',
    'deno',
    'tsx',
    'ts-node',
    'php',
    'lua',
    'luajit',
    'osascript',
    'pwsh',
    'powershell',
    'sh',
    'bash',
    'zsh',
    'dash',
    'ksh',
    'fish',
  ]);
  static readonly SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
  static readonly COPIERS = new Set(['cp', 'install', 'rsync', 'ln']);
  /** Programs that run a package's program. */
  static readonly LAUNCHERS = new Set(['bunx', 'npx', 'pnpx']);
  /** Package managers and the subcommands that run a package's program. */
  static readonly PACKAGE_RUNNERS = new Map<string, string[]>([
    ['bun', ['x']],
    ['pnpm', ['dlx', 'exec']],
    ['yarn', ['dlx', 'exec']],
    ['npm', ['exec']],
  ]);
  /** Programs that write the file without the extension of the compressed one they are given. */
  static readonly DECOMPRESSORS = new Set([
    'gunzip',
    'unxz',
    'unzstd',
    'bunzip2',
    'unlz4',
    'uncompress',
    'unlzma',
  ]);
  static readonly COMPRESSORS = new Set(['gzip', 'xz', 'zstd', 'bzip2', 'lz4', 'lzma']);
  static readonly COMPRESSED_SUFFIX = /\.(?:gz|xz|zst|bz2|lz4|z|lzma|tgz|taz)$/i;
  static readonly EXTRACT_PROGRAMS = new Set([
    'cpio',
    'ar',
    '7z',
    '7za',
    '7zr',
    '7zz',
    'jar',
    'pax',
  ]);
  /** A number given to an option, not a file. */
  static readonly NUMBER = /^(?:\d+|0x[0-9a-f]+)$/i;
  static readonly AWK_REDIRECT = /(?<![=!<>-])>(?!=)/;
  static readonly AWK_PIPE = /(?<!\|)\|(?!\|)/;
  static readonly PERL_WRITES =
    /\b(?:open|sysopen|unlink|rename|truncate|system|exec|syswrite|mkdir|rmdir|link|symlink|chmod|chown|utime|copy|move|qx|File|IO)\b|`|\$\^I/;
  static readonly RUBY_WRITES =
    /\b(?:File|IO|FileUtils|Dir|Kernel|open|system|exec|spawn|write|delete|unlink|rename|truncate|popen)\b|`|%x/;
  static readonly SED_COMMAND = /(?:^|[\s;{}!0-9$/])[weW](?:\s|$)/;
  static readonly SED_FLAG = /\/[gpiImMx0-9]*[we][gpiImMx0-9]*(?:\s|;|$)/;
  static readonly SHELL_FEEDERS = new Set(['echo', 'printf']);
  /** `for NAME in WORDS` and `select NAME in WORDS` only walk their list; the body reads what it does with each word. */
  static readonly LOOP_HEADERS = new Set(['for', 'select']);
  /** Programs that turn a word into something else: a folder, a variable, a command, a list. A closed path given to one is still a mention. */
  static readonly MENTION_PROGRAMS = new Set([
    ...ManifestShell.LOOP_HEADERS,
    'cd',
    'pushd',
    'popd',
    'eval',
    'source',
    '.',
    'exec',
    'xargs',
    'parallel',
    'find',
    'fd',
    'read',
    'mapfile',
    'readarray',
    'export',
    'declare',
    'typeset',
    'local',
    'readonly',
    'set',
    'unset',
    'alias',
    'trap',
    'builtin',
    'command',
  ]);
  /** A line that names `IFS`, or defines a function (`f() ...`, `function f ...`). */
  static readonly REBINDS = /\bIFS\b|(?:^|[\s;&|(){}])(?:function\s+[\w:.-]+|[\w:.-]+\s*\(\s*\))/;
  /** Programs that read a file into the shell. */
  static readonly READ_BACK = new Set(['read', 'mapfile', 'readarray', 'source', '.']);
  /** Programs that hand a variable to the commands it starts. */
  static readonly EXPORTERS = new Set(['export', 'declare', 'typeset', 'readonly', 'set']);
  static readonly MAX_EXEMPT_COMMANDS = 200;
  static readonly FIND_ACTIONS = new Set([
    '-delete',
    '-exec',
    '-execdir',
    '-ok',
    '-okdir',
    '-fprint',
    '-fprint0',
    '-fprintf',
    '-fls',
  ]);
  static readonly FIND_NAME_FILTERS = new Set(['-name', '-iname', '-path', '-ipath', '-wholename']);
  static readonly UNZIP_LISTS = new Set(['-l', '-t', '-p', '-Z', '-v']);
  static readonly TAR_LISTS = new Set(['t', 'c', 'd']);
  static readonly TAR_WRITES = new Set(['r', 'u']);

  private static view: IView = { previous: undefined, dotglob: false, globstar: false };

  /** Whether the line is about the `.agents` folder: it says `agents` somewhere that is not a closed path used as written. */
  private static isAboutFolder(opts: {
    commands: ISimpleCommand[];
    line: string;
    dir: string;
  }): boolean {
    const total = InlineScript.agentsCount({ text: opts.line });

    // More exempted than said would mean the words and the text disagree: not told, so about.
    return total > 0 && ManifestShell.exemptedMentions(opts) !== total;
  }

  /** Whether a closed path, read from the folder `dir`, has a link below its `agents` folder. */
  private static hasLinkBelow(opts: { word: string; dir: string }): boolean {
    const at = opts.word.toLowerCase().indexOf(`${InlineScript.AGENTS}/`);

    if (at === -1) {
      return true;
    }

    const end = at + InlineScript.AGENTS.length;
    const folder = resolve(opts.dir, opts.word.slice(0, end));
    const parent = dirname(resolve(folder, `.${opts.word.slice(end)}`));
    const realFolder = ManifestPath.resolveReal({ path: folder });
    const realParent = ManifestPath.resolveReal({ path: parent });

    return (
      realFolder === undefined ||
      realParent === undefined ||
      realParent !== join(realFolder, relative(folder, parent))
    );
  }

  /** The name of a variable the word is, on its own: `$F`, `${F}`. */
  private static bareVariableOf(opts: { word: string }): string | undefined {
    return /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})$/.exec(opts.word)?.slice(1).find(Boolean);
  }

  /**
   * How many mentions of `agents` on the line are a closed path (`InlineScript.isClosedPath`) used as it is
   * written: an argument or a redirect target of a command at the top of the line. A path in any other
   * place still counts: an assignment value, a `for` or `select` word, a word after the script of
   * `sh -c`, a command inside `$(...)` or `<(...)`, the argument of a command whose output is kept (a
   * file, a variable, a pipe into anything but a reader), and a path with a link below its `agents`
   * folder. A variable that holds a closed path is let through only when every use of it on the line is
   * the bare word `$NAME` given to a command that takes it as it is.
   */
  private static exemptedMentions(opts: {
    commands: ISimpleCommand[];
    line: string;
    dir: string;
  }): number {
    const { commands, line } = opts;

    if (commands.length > ManifestShell.MAX_EXEMPT_COMMANDS) {
      return 0;
    }

    const calls = commands.map((command) => ManifestShell.callOf({ command }));

    // A link made on the line can turn a closed path into another one. So can a line that splits words on
    // another character (`IFS`), sets a variable by `printf -v`, or defines a function, whose parameters
    // take a closed path and put it into another word.
    if (
      calls.some(
        (call) =>
          call.program === 'ln' || (call.program === 'printf' && call.args[0]?.startsWith('-v')),
      ) ||
      ManifestShell.REBINDS.test(line)
    ) {
      return 0;
    }

    const hasExports = calls.some((call) => ManifestShell.EXPORTERS.has(call.program));
    const kept = new Set<ISimpleCommand>();
    // The files the line reads back into the shell: in a command inside `$(...)`, as an input, or for `read`.
    const readBack = new Set<string>();

    for (const [index, command] of commands.entries()) {
      const call = calls[index];

      if (call === undefined) {
        continue;
      }

      if (command.scope !== undefined || ManifestShell.READ_BACK.has(call.program)) {
        call.args.forEach((word) => readBack.add(word));
      }

      command.input?.files.forEach((file) => readBack.add(file));
    }

    for (const [index, command] of commands.entries()) {
      const producer = command.input?.pipedFrom;
      const call = calls[index];

      if (
        producer !== undefined &&
        call !== undefined &&
        (call.isFed || !ManifestShell.isReader({ program: call.program, args: call.args }))
      ) {
        kept.add(producer);
      }

      // Output written to a file the line reads back is kept as well; `$(<file)` is not told, so any file counts.
      if (
        command.redirects.some(
          (target) =>
            !target.startsWith('&') &&
            target !== '/dev/null' &&
            (readBack.has(target) || /\$\(\s*<|`\s*</.test(line)),
        )
      ) {
        kept.add(command);
      }
    }

    const binders: { name: string; count: number }[] = [];
    const uses = new Map<string, number>();
    let exempt = 0;
    let links = 0;
    let dir = opts.dir;
    let previous = opts.dir;

    for (const [index, command] of commands.entries()) {
      const call = calls[index];

      if (call === undefined) {
        continue;
      }

      const isClosed = (word: string): boolean => {
        if (!InlineScript.isClosedPath({ word })) {
          return false;
        }

        links += 1;

        return (
          links <= ManifestShell.MAX_EXEMPT_COMMANDS && !ManifestShell.hasLinkBelow({ word, dir })
        );
      };

      if (command.scope === undefined && command.carrier === undefined) {
        const isGiven =
          !ManifestShell.MENTION_PROGRAMS.has(call.program) &&
          !call.isFed &&
          call.nested.length === 0 &&
          InlineScript.payloadOf({ args: call.args }) === -1 &&
          command.heredoc === undefined &&
          !kept.has(command);

        for (const word of call.args) {
          const name = ManifestShell.bareVariableOf({ word });

          if (!isGiven) {
            continue;
          }

          if (name !== undefined) {
            uses.set(name, (uses.get(name) ?? 0) + 1);
          } else if (isClosed(word)) {
            exempt += InlineScript.agentsCount({ text: word });
          }
        }

        for (const target of command.redirects) {
          if (!target.startsWith('&') && isClosed(target)) {
            exempt += InlineScript.agentsCount({ text: target });
          }
        }

        if (!hasExports && command.words.length === 0) {
          for (const assignment of command.assignments) {
            const equals = assignment.indexOf('=');
            const value = assignment.slice(equals + 1);

            if (
              equals > 0 &&
              /^[A-Za-z_]\w*$/.test(assignment.slice(0, equals)) &&
              isClosed(value)
            ) {
              binders.push({
                name: assignment.slice(0, equals),
                count: InlineScript.agentsCount({ text: value }),
              });
            }
          }
        }

        if (!hasExports && ManifestShell.LOOP_HEADERS.has(call.program) && call.args[1] === 'in') {
          const values = call.args.slice(2);

          if (
            values.length > 0 &&
            /^[A-Za-z_]\w*$/.test(call.args[0] ?? '') &&
            values.every((word) => isClosed(word))
          ) {
            binders.push({
              name: call.args[0] ?? '',
              count: values.reduce(
                (sum, word) => sum + InlineScript.agentsCount({ text: word }),
                0,
              ),
            });
          }
        }
      }

      ({ dir, previous } = ManifestShell.folderAfter({ call, dir, previous, isAbout: true }));
    }

    for (const binder of binders) {
      const pattern = new RegExp(`\\$\\{?${binder.name}(?![A-Za-z0-9_])`, 'g');

      if ((line.match(pattern)?.length ?? 0) === (uses.get(binder.name) ?? 0)) {
        exempt += binder.count;
      }
    }

    return exempt;
  }

  /** Whether a line that starts in `from` is now in `to`, and `to` is inside a folder of a manifest it could mean that `from` is not in. */
  private static entersFolder(opts: { from: string; to: string }): boolean {
    if (opts.from === opts.to) {
      return false;
    }

    const isInside = (inner: string, folder: string): boolean =>
      inner === folder || inner.startsWith(`${folder}/`);

    return ManifestPath.candidatesOf({ dir: opts.to })
      .map((manifest) => dirname(manifest))
      .some((folder) => isInside(opts.to, folder) && !isInside(opts.from, folder));
  }

  /** What a word names, read with the folder before and the glob options of the line. */
  private static classify(opts: {
    word: string;
    dir: string;
    isAbout: boolean;
  }): TPathRef | undefined {
    return PathRef.classify({ ...opts, ...ManifestShell.view });
  }

  /** The value of an option: `-C dir`, `--directory dir` or `--directory=dir`. */
  private static optionValue(opts: { args: string[]; names: string[] }): string | undefined {
    for (const [index, word] of opts.args.entries()) {
      const name = opts.names.find((item) => word === item || word.startsWith(`${item}=`));

      if (name === word) {
        return opts.args[index + 1];
      }

      if (name !== undefined) {
        return word.slice(name.length + 1);
      }
    }

    return undefined;
  }

  /** The folder an `env -C dir` / `env --chdir=dir` in front of the command moves it to. */
  private static chdirOf(opts: { words: string[] }): string | undefined {
    const at = opts.words.findIndex((word) => ShellParser.basenameOf({ word }) === 'env');

    if (at === -1) {
      return undefined;
    }

    const rest = opts.words.slice(at + 1);

    return ManifestShell.optionValue({ args: rest, names: ['-C', '--chdir'] });
  }

  /** The program of a simple command past the wrappers, with the text it carries for a shell. */
  private static callOf(opts: { command: ISimpleCommand }): ICall {
    const parsed = ShellParser.programOf({ command: opts.command });
    let program = ShellParser.basenameOf({ word: parsed.name });
    let { args } = parsed;
    const nested: string[] = [];
    const before = opts.command.words.slice(0, Math.max(parsed.index, 0));
    const isFed = before.some((word) => ShellParser.basenameOf({ word }) === 'xargs');

    for (let step = 0; step < 4; step += 1) {
      const unwrapped = ManifestShell.unwrap({ program, args });

      if (unwrapped === undefined) {
        break;
      }

      ({ program, args } = unwrapped);
      nested.push(...unwrapped.nested);
    }

    // A shell a wrapper runs: its `-c` string is a command line (the parser reads those of a bare shell).
    if (ManifestShell.SHELLS.has(program)) {
      const flag = args.findIndex((word) => /^-[A-Za-z]*c$/.test(word));

      if (flag !== -1) {
        nested.push(args[flag + 1] ?? '');
      }
    }

    // `trap 'cmd' SIGNAL` keeps a command line to run later.
    const code = program === 'trap' ? args.find((word) => !word.startsWith('-')) : undefined;

    if (code !== undefined) {
      nested.push(code);
    }

    return { program, args, nested, isFed, chdir: ManifestShell.chdirOf({ words: before }) };
  }

  /** What a wrapper that `programOf` does not know runs: `busybox cp`, `flock lock cmd`, `chroot dir cmd`, `script -c 'cmd'` ... */
  private static unwrap(opts: {
    program: string;
    args: string[];
  }): { program: string; args: string[]; nested: string[] } | undefined {
    const { args } = opts;
    const valued = new Set([
      '-w',
      '-E',
      '--timeout',
      '--wait',
      '--conflict-exit-code',
      '-j',
      '-n',
      '-N',
      '-S',
      '-a',
    ]);

    switch (opts.program) {
      case 'busybox': {
        return {
          program: ShellParser.basenameOf({ word: args[0] ?? '' }),
          args: args.slice(1),
          nested: [],
        };
      }
      case 'flock':
      case 'chroot':
      case 'unshare':
      case 'parallel': {
        const isPositional = opts.program === 'flock' || opts.program === 'chroot';
        const nested: string[] = [];
        let index = 0;

        while (index < args.length && (args[index] ?? '').startsWith('-')) {
          const word = args[index] ?? '';

          if ((word === '-c' || word === '--command') && opts.program === 'flock') {
            nested.push(args[index + 1] ?? '');
          }

          index += valued.has(word) || word === '-c' ? 2 : 1;
        }

        index += isPositional ? 1 : 0;

        // `flock lock -c cmd`: the command is a string after the lock file.
        if (opts.program === 'flock' && (args[index] === '-c' || args[index] === '--command')) {
          nested.push(args[index + 1] ?? '');

          return { program: '', args: [], nested };
        }

        return {
          program: ShellParser.basenameOf({ word: args[index] ?? '' }),
          args: args.slice(index + 1),
          nested,
        };
      }
      case 'bunx':
      case 'npx':
      case 'pnpx':
      case 'bun':
      case 'pnpm':
      case 'yarn':
      case 'npm': {
        const runner = ManifestShell.PACKAGE_RUNNERS.get(opts.program);

        if (runner !== undefined && !runner.includes(args[0] ?? '')) {
          return undefined;
        }

        const rest = runner === undefined ? args : args.slice(1);
        const index = Math.max(
          rest.findIndex((word) => !word.startsWith('-')),
          0,
        );

        return rest.length === 0
          ? undefined
          : {
              program: ShellParser.basenameOf({ word: rest[index] ?? '' }),
              args: rest.slice(index + 1),
              nested: [],
            };
      }
      case 'script': {
        const flag = args.findIndex((word) => /^-[A-Za-z]*c$/.test(word));

        return flag === -1 ? undefined : { program: '', args: [], nested: [args[flag + 1] ?? ''] };
      }
      default: {
        return undefined;
      }
    }
  }

  /** The words of a command that name the manifest or its folder: options give their value (`--output=..`, `of=..`). */
  private static refsOf(opts: {
    program: string;
    args: string[];
    dir: string;
    isAbout: boolean;
  }): IRef[] {
    const refs: IRef[] = [];

    opts.args.forEach((word, index) => {
      let target: string | undefined = word;
      const equals = word.indexOf('=');

      if (word.startsWith('-')) {
        target = equals > 0 ? word.slice(equals + 1) : undefined;
      } else if (/^[A-Za-z_]+=/.test(word)) {
        target =
          opts.program === 'dd' && word.startsWith('if=') ? undefined : word.slice(equals + 1);
      }

      const kind =
        target === undefined
          ? undefined
          : ManifestShell.classify({ word: target, dir: opts.dir, isAbout: opts.isAbout });

      if (kind !== undefined) {
        refs.push({ index, kind });
      }
    });

    return refs;
  }

  private static isInPlace(opts: { program: string; args: string[] }): boolean {
    if (opts.program === 'awk' || opts.program === 'gawk' || opts.program === 'mawk') {
      return (
        opts.args.includes('inplace') || opts.args.some((word) => word.startsWith('-iinplace'))
      );
    }

    return opts.args.some((word) => /^-[A-Za-z0-9]*i/.test(word) || word.startsWith('--in-place'));
  }

  /** Whether the script words of a stream editor write: a redirect or pipe in awk, a command that opens a file in perl, sed's `w` and `e`. When it cannot be told it does. */
  private static scriptWrites(opts: { program: string; args: string[] }): boolean {
    const { program, args } = opts;
    const text = args.filter((word) => !word.startsWith('-')).join('\n');
    const hasPayload = args.some((word) => /^-[A-Za-z]*[eE]$/.test(word));

    if (args.some((word) => word === '-f' || word === '--file')) {
      return true;
    }

    switch (program) {
      case 'awk':
      case 'gawk':
      case 'mawk': {
        const at = text.search(/\bprintf?\b/);

        return (
          /\bsystem\s*\(/.test(text) ||
          ManifestShell.AWK_PIPE.test(text) ||
          (at !== -1 && ManifestShell.AWK_REDIRECT.test(text.slice(at)))
        );
      }
      case 'perl': {
        return !hasPayload || ManifestShell.PERL_WRITES.test(text);
      }
      case 'ruby': {
        return !hasPayload || ManifestShell.RUBY_WRITES.test(text);
      }
      default: {
        return ManifestShell.SED_COMMAND.test(text) || ManifestShell.SED_FLAG.test(text);
      }
    }
  }

  /** The words of a command that are files, not options or the numbers given to them. */
  private static positionalsOf(opts: { args: string[] }): string[] {
    return opts.args.filter((word) => !word.startsWith('-') && !ManifestShell.NUMBER.test(word));
  }

  /** Whether a reader writes: it is given an output file or an option that runs a command. */
  private static writesFile(opts: { program: string; args: string[] }): boolean {
    const { program, args } = opts;

    switch (program) {
      case 'sort': {
        return args.some((word) => /^-[A-Za-z]*o/.test(word) || word.startsWith('--o'));
      }
      case 'tree': {
        return args.includes('-o');
      }
      case 'yq': {
        return args.includes('-i') || args.includes('--inplace');
      }
      case 'less': {
        return args.some((word) => /^-[A-Za-z]*[oO]/.test(word) || /^--log-file/i.test(word));
      }
      case 'rg': {
        return args.some((word) => word.startsWith('--pre'));
      }
      case 'uniq': {
        return ManifestShell.positionalsOf({ args }).length >= 2;
      }
      case 'xxd': {
        return (
          ManifestShell.positionalsOf({ args }).length >= 2 ||
          args.some((word) => /^-[A-Za-z]*r/.test(word) || word === '-revert')
        );
      }
      default: {
        return false;
      }
    }
  }

  /** Whether the program, with these arguments, only reads the files it is given. */
  private static isReader(opts: { program: string; args: string[] }): boolean {
    const { program, args } = opts;
    const checker = ManifestShell.CHECKERS.get(program);

    if (ManifestShell.FILTERS.has(program)) {
      return (
        !ManifestShell.isInPlace({ program, args }) &&
        !ManifestShell.scriptWrites({ program, args })
      );
    }

    if (checker !== undefined) {
      return !args.some((word) => checker.includes(word));
    }

    return ManifestShell.READERS.has(program) && !ManifestShell.writesFile({ program, args });
  }

  /** The commands a `find` runs (`-exec cmd {} +`), each as its words. */
  private static execsOf(opts: { args: string[] }): string[][] {
    const commands: string[][] = [];
    let current: string[] | undefined;

    for (const word of opts.args) {
      if (['-exec', '-execdir', '-ok', '-okdir'].includes(word)) {
        current = [];
        commands.push(current);
      } else if (current !== undefined && (word === ';' || word === '+')) {
        current = undefined;
      } else if (current !== undefined) {
        current.push(word);
      }
    }

    return commands;
  }

  /** Whether a `find` writes: it deletes, writes a list to a file, or runs a command that is not a reader. */
  private static findWrites(opts: { args: string[] }): boolean {
    return (
      opts.args.some(
        (word) => word === '-delete' || word.startsWith('-fprint') || word === '-fls',
      ) ||
      ManifestShell.execsOf({ args: opts.args }).some(([program, ...args]) => {
        const name = ShellParser.basenameOf({ word: program ?? '' });

        return !ManifestShell.isReader({
          program: name,
          args: args.filter((word) => word !== '{}'),
        });
      })
    );
  }

  /** Whether the `find` runs a writing action on a path that could be the manifest. */
  private static findDenies(opts: { args: string[]; dir: string; isAbout: boolean }): boolean {
    const { args } = opts;

    if (!ManifestShell.findWrites({ args })) {
      return false;
    }

    const stop = args.findIndex((word) => word.startsWith('-') || word === '(' || word === '!');
    const starts = stop === -1 ? args : args.slice(0, stop);
    const named = [
      ...new Set(
        args.filter((_word, index) => ManifestShell.FIND_NAME_FILTERS.has(args[index - 1] ?? '')),
      ),
    ];
    // A regular expression is not read: it could match anything.
    const expressions = args.some((word) => word === '-regex' || word === '-iregex') ? ['*'] : [];
    // Too many filters to read one by one could be any.
    const filters = named.length > ManifestShell.MAX_FILTERS ? ['*'] : [...named, ...expressions];
    const canHit =
      filters.length === 0 ||
      filters.some(
        (filter) =>
          PathPattern.matches({ pattern: filter, text: ManifestPath.NAME, crossesSlash: true }) ||
          PathPattern.matches({ pattern: filter, text: ManifestPath.SUFFIX, crossesSlash: true }) ||
          PathPattern.matches({
            pattern: `*${filter}`,
            text: ManifestPath.SUFFIX,
            crossesSlash: true,
          }),
      );
    const covers = (start: string): boolean => {
      const absolute = resolve(opts.dir, start);

      return (
        ManifestShell.classify({ word: start, dir: opts.dir, isAbout: opts.isAbout }) !==
          undefined ||
        ManifestPath.candidatesOf({ dir: opts.dir }).some((manifest) =>
          manifest.startsWith(`${absolute.replace(/\/$/, '')}/`),
        )
      );
    };

    return canHit && (starts.length === 0 ? covers('.') : starts.some(covers));
  }

  /** Whether extracting into `folder` (or a member named `.agents`) could put files where the manifest is. */
  private static extractsInto(opts: {
    folder: string;
    members: string[];
    dir: string;
    isAbout: boolean;
  }): boolean {
    const real = ManifestPath.resolveReal({ path: opts.folder }) ?? opts.folder;

    return (
      ManifestPath.holds({ folder: opts.folder }) ||
      ManifestPath.holds({ folder: real }) ||
      opts.members.some(
        (member) =>
          ManifestPath.isFolder({ word: member }) ||
          ManifestShell.classify({ word: member, dir: opts.dir, isAbout: opts.isAbout }) !==
            undefined,
      )
    );
  }

  private static tarDenies(opts: { args: string[]; dir: string; isAbout: boolean }): boolean {
    const { args } = opts;
    const first = args[0] ?? '';
    const letters = new Set<string>([
      ...(first.startsWith('-') ? [] : first.split('')),
      ...args
        .filter((word) => /^-[A-Za-z]+$/.test(word))
        .flatMap((word) => word.slice(1).split('')),
    ]);
    const isExtract =
      letters.has('x') || args.some((word) => word === '--extract' || word === '--get');
    const directory = ManifestShell.optionValue({ args, names: ['-C', '--directory'] });
    const folder = resolve(opts.dir, directory ?? '.');
    const given = ManifestShell.optionValue({ args, names: ['-f', '--file'] });
    const clusterAt = args.findIndex((word) => /^-[A-Za-z]*f$/.test(word));
    const named = clusterAt === -1 ? undefined : args[clusterAt + 1];
    const archive =
      given ?? named ?? (letters.has('f') && !first.startsWith('-') ? args[1] : undefined);

    if (isExtract) {
      return ManifestShell.extractsInto({
        folder,
        members: args.filter((word) => !word.startsWith('-')).slice(1),
        dir: opts.dir,
        isAbout: opts.isAbout,
      });
    }

    const isWriter =
      [...letters].some((letter) => ManifestShell.TAR_WRITES.has(letter)) ||
      args.some((word) => word === '--delete' || word === '--append' || word === '--update') ||
      (letters.has('c') && archive !== undefined);

    return (
      isWriter &&
      archive !== undefined &&
      ManifestShell.classify({ word: archive, dir: opts.dir, isAbout: opts.isAbout }) !== undefined
    );
  }

  private static unzipDenies(opts: { args: string[]; dir: string; isAbout: boolean }): boolean {
    const { args } = opts;

    if (args.some((word) => ManifestShell.UNZIP_LISTS.has(word))) {
      return false;
    }

    const folder = resolve(opts.dir, ManifestShell.optionValue({ args, names: ['-d'] }) ?? '.');

    return ManifestShell.extractsInto({
      folder,
      members: args.filter((word) => !word.startsWith('-')).slice(1),
      dir: opts.dir,
      isAbout: opts.isAbout,
    });
  }

  /** Whether a copy, install, sync or link puts something where the manifest is, or a tree where it is kept. */
  private static copierDenies(opts: {
    program: string;
    args: string[];
    dir: string;
    isAbout: boolean;
  }): boolean {
    const { program, args, dir, isAbout } = opts;
    const target = ManifestShell.optionValue({ args, names: ['-t', '--target-directory'] });
    const files = args.filter(
      (word, index) =>
        !word.startsWith('-') &&
        !(args[index - 1] === '-t' || args[index - 1] === '--target-directory'),
    );
    const destination = target ?? files[files.length - 1];
    const sources = target === undefined ? files.slice(0, -1) : files;
    const isTree =
      program === 'rsync' ||
      args.some((word) => /^-[A-Za-z]*[rRa]/.test(word) || /^--(?:recursive|archive)/.test(word));
    const classify = (word: string): TPathRef | undefined =>
      ManifestShell.classify({ word, dir, isAbout });

    if (destination === undefined || sources.length === 0) {
      return false;
    }

    const kind = classify(destination);

    if (kind === 'manifest') {
      return true;
    }

    if (kind === 'folder') {
      return (
        isTree ||
        program === 'ln' ||
        sources.some(
          (word) =>
            classify(word) !== undefined ||
            PathPattern.isWild({ word }) ||
            InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) }),
        )
      );
    }

    if (!isTree) {
      return false;
    }

    const folder = resolve(dir, destination);
    const real = ManifestPath.resolveReal({ path: folder }) ?? folder;

    if (ManifestPath.holds({ folder }) || ManifestPath.holds({ folder: real })) {
      return true;
    }

    // A folder named `.agents` copied onto the folder it would be made in merges into the one there.
    return (
      sources.some((word) => ManifestPath.isFolder({ word })) &&
      (dir === folder || dir.startsWith(`${folder.replace(/\/$/, '')}/`))
    );
  }

  /** Where the shell stands after a simple command (`cd`, `pushd`, `popd`), and the folder it was in before. */
  private static folderAfter(opts: {
    call: ICall;
    dir: string;
    previous: string;
    isAbout: boolean;
  }): { dir: string; previous: string } {
    const { program, args } = opts.call;
    const target = args.find((word) => !word.startsWith('-') || word === '-');
    const stays = { dir: opts.dir, previous: opts.previous };

    if (program === 'popd') {
      return { dir: opts.previous, previous: opts.dir };
    }

    if ((program !== 'cd' && program !== 'pushd') || target === undefined) {
      return stays;
    }

    if (target === '-') {
      return { dir: opts.previous, previous: opts.dir };
    }

    // A folder that is not known, on a line about `.agents`, is taken to be `.agents`.
    if (PathPattern.hasExpansion({ word: target })) {
      return opts.isAbout
        ? { dir: join(opts.dir, ManifestPath.FOLDER), previous: opts.dir }
        : stays;
    }

    const next = resolve(opts.dir, target);

    return { dir: ManifestPath.resolveReal({ path: next }) ?? next, previous: opts.dir };
  }

  /** The folder a program that unpacks an archive unpacks into, or `undefined` when it does not unpack. */
  private static unpackFolderOf(opts: {
    program: string;
    args: string[];
    dir: string;
  }): string | undefined {
    const { program, args, dir } = opts;
    const first = args[0] ?? '';
    const cluster = (letter: string): boolean =>
      (!first.startsWith('-') && first.includes(letter)) ||
      args.some((word) => new RegExp(`^-[A-Za-z]*${letter}`).test(word));

    switch (program) {
      case 'cpio': {
        return cluster('i') || args.includes('--extract')
          ? resolve(dir, ManifestShell.optionValue({ args, names: ['-D', '--directory'] }) ?? '.')
          : undefined;
      }
      case 'ar': {
        return cluster('x') ? dir : undefined;
      }
      case '7z':
      case '7za':
      case '7zr':
      case '7zz': {
        const out = args.find((word) => word.startsWith('-o'));

        return first === 'x' || first === 'e'
          ? resolve(dir, out === undefined ? '.' : out.slice(2))
          : undefined;
      }
      case 'jar': {
        return cluster('x')
          ? resolve(dir, ManifestShell.optionValue({ args, names: ['-C'] }) ?? '.')
          : undefined;
      }
      case 'pax': {
        return args.includes('-r') && !args.includes('-w') ? dir : undefined;
      }
      default: {
        return undefined;
      }
    }
  }

  /** Whether a program that decompresses writes a file named like the one it is given, without its extension. */
  private static decompressDenies(opts: {
    program: string;
    args: string[];
    dir: string;
    isAbout: boolean;
  }): boolean {
    const { program, args } = opts;
    const isFlagged = ManifestShell.COMPRESSORS.has(program);
    const decompresses =
      ManifestShell.DECOMPRESSORS.has(program) ||
      (isFlagged &&
        args.some(
          (word) => /^-[A-Za-z]*d/.test(word) || word === '--decompress' || word === '--uncompress',
        ));
    const toOutput = args.some(
      (word) =>
        word === '--stdout' ||
        word === '--to-stdout' ||
        (/^-[A-Za-z]+$/.test(word) && word.includes('c')),
    );

    if (!decompresses || toOutput) {
      return false;
    }

    return args
      .filter((word) => !word.startsWith('-'))
      .some(
        (word) =>
          ManifestShell.classify({
            word: word.replace(ManifestShell.COMPRESSED_SUFFIX, ''),
            dir: opts.dir,
            isAbout: opts.isAbout,
          }) !== undefined,
      );
  }

  /** Whether `zip` writes an archive that is the manifest or its folder, or moves the file into one. */
  private static zipDenies(opts: { args: string[]; dir: string; isAbout: boolean }): boolean {
    const { args } = opts;
    const archive = args.find((word) => !word.startsWith('-'));
    const output = ManifestShell.optionValue({ args, names: ['-O', '--output-file'] });
    const isRef = (word: string | undefined): boolean =>
      word !== undefined &&
      ManifestShell.classify({ word, dir: opts.dir, isAbout: opts.isAbout }) !== undefined;
    const moves = args.some((word) => /^-[A-Za-z]*m/.test(word) || word === '--move');

    return (
      isRef(archive) ||
      isRef(output) ||
      (moves && args.some((word) => !word.startsWith('-') && isRef(word)))
    );
  }

  private static gitDenies(opts: {
    command: ISimpleCommand;
    call: ICall;
    line: string;
    dir: string;
    isAbout: boolean;
    isLaterStash: boolean;
  }): boolean {
    const { args } = opts.call;

    if (
      GitRewrite.rewrites({
        command: opts.command,
        args,
        line: opts.line,
        dir: opts.dir,
        isAbout: opts.isAbout,
        isLaterStash: opts.isLaterStash,
      })
    ) {
      return true;
    }

    const { sub } = GitRewrite.subOf({ args });

    // The forms above read their own paths.
    if (['checkout', 'restore', 'apply', 'am', 'read-tree'].includes(sub)) {
      return false;
    }

    // A file the command writes its output to.
    const outputs = args.flatMap((word, index) => {
      if (word === '--output') {
        return [args[index + 1] ?? ''];
      }

      return word.startsWith('--output=') ? [word.slice('--output='.length)] : [];
    });

    if (
      outputs.some(
        (word) =>
          ManifestShell.classify({ word, dir: opts.dir, isAbout: opts.isAbout }) !== undefined,
      )
    ) {
      return true;
    }

    const refs = ManifestShell.refsOf({
      program: 'git',
      args,
      dir: opts.dir,
      isAbout: opts.isAbout,
    });

    if (refs.length === 0) {
      return false;
    }

    const words = args.slice(args.indexOf(sub) + 1);
    const isStashRead =
      sub === 'stash' &&
      GitRewrite.STASH_READS.has(words.find((word) => !word.startsWith('-')) ?? '');
    // `git rm --cached` takes the file out of the index and leaves it where it is.
    const isIndexOnly = sub === 'rm' && words.includes('--cached');

    return !(GitRewrite.READS_PATHS.has(sub) || isStashRead || isIndexOnly);
  }

  /** Whether the script an interpreter runs, or a word it is given, changes the manifest. */
  private static runnerDenies(opts: {
    command: ISimpleCommand;
    call: ICall;
    line: string;
    dir: string;
    refs: IRef[];
    context: ILine;
  }): boolean {
    const { call, context } = opts;
    const script = InlineScript.scriptOf({
      program: call.program,
      args: call.args,
      heredoc: opts.command.heredoc,
      skip: opts.refs.map((ref) => ref.index),
    });
    const payload = InlineScript.payloadOf({ args: call.args });
    const isInsideFolder =
      context.cwd !== undefined &&
      context.cwd.split('/').includes(ManifestPath.FOLDER) &&
      (basename(context.cwd) === ManifestPath.FOLDER || (script?.text.includes('..') ?? false));

    if (
      script !== undefined &&
      InlineScript.writesManifest({
        script,
        dir: opts.dir,
        line: opts.line,
        isInsideFolder,
        inspectShell: ({ line, dir }) =>
          ManifestShell.inspectLine({ line, dir, cwd: context.cwd, depth: context.depth + 1 }),
      })
    ) {
      return true;
    }

    // `python -m json.tool in [out]` writes its second file.
    if (
      call.program.startsWith('python') &&
      call.args[0] === '-m' &&
      call.args[1] === 'json.tool'
    ) {
      return ManifestShell.positionalsOf({ args: call.args.slice(2) }).length >= 2;
    }

    // `python -m zipfile -e archive folder` unpacks into the folder.
    if (call.program.startsWith('python') && call.args[0] === '-m' && call.args[1] === 'zipfile') {
      const [folder] = call.args.filter((word) => !word.startsWith('-')).slice(-1);

      return (
        call.args.some((word) => word === '-e' || word === '-x' || word === '--extract') &&
        ManifestShell.extractsInto({
          folder: resolve(opts.dir, folder ?? '.'),
          members: [],
          dir: opts.dir,
          isAbout: context.isAbout,
        })
      );
    }

    // A script given inline was read above; one run from a file is not read, and is not let through only
    // when it is given the manifest itself.
    if (ManifestShell.FILTERS.has(call.program) && opts.refs.length > 0) {
      return !ManifestShell.isReader({ program: call.program, args: call.args });
    }

    if (payload !== -1 || opts.command.heredoc !== undefined) {
      return false;
    }

    // A filter that is not given a script is read by what it is given.
    if (ManifestShell.FILTERS.has(call.program)) {
      return (
        opts.refs.length > 0 && !ManifestShell.isReader({ program: call.program, args: call.args })
      );
    }

    return opts.refs.some((ref) => ref.kind === 'manifest');
  }

  private static inspectSimple(opts: {
    command: ISimpleCommand;
    line: string;
    dir: string;
    context: ILine;
    hasRef: () => boolean;
  }): boolean {
    const { command, line, context } = opts;
    const call = ManifestShell.callOf({ command });
    const { program, args } = call;
    const dir = call.chdir === undefined ? opts.dir : resolve(opts.dir, call.chdir);
    const isAbout =
      context.isAbout ||
      basename(dir) === ManifestPath.FOLDER ||
      ManifestShell.entersFolder({ from: context.startDir, to: dir });

    if (
      call.nested.some((nested) =>
        ManifestShell.inspectLine({
          line: nested,
          dir,
          cwd: context.cwd,
          depth: context.depth + 1,
        }),
      )
    ) {
      return true;
    }

    // A redirect is always a write.
    if (
      [...new Set(command.redirects)].some(
        (target) =>
          !target.startsWith('&') &&
          ManifestShell.classify({ word: target, dir, isAbout }) !== undefined,
      )
    ) {
      return true;
    }

    if (ManifestShell.LOOP_HEADERS.has(program)) {
      return false;
    }

    if (program === 'git') {
      const isDenied = ManifestShell.gitDenies({
        command,
        call,
        line,
        dir,
        isAbout,
        isLaterStash: context.stashMoves > 0,
      });

      context.stashMoves += GitRewrite.stashActionOf({ args }) === undefined ? 0 : 1;

      return isDenied;
    }

    if (call.isFed && !ManifestShell.isReader({ program, args }) && opts.hasRef()) {
      return true;
    }

    if (program === 'patch') {
      const isDryRun = args.some(
        (word) => word === '--dry-run' || word === '-C' || word === '--check',
      );
      const input = ManifestShell.optionValue({ args, names: ['-i', '--input'] });
      const files = input === undefined ? [] : [input];

      if (!isDryRun && PatchInput.refuses({ files, heredoc: command.heredoc, line, dir })) {
        return true;
      }
    }

    if (ManifestShell.COPIERS.has(program)) {
      return ManifestShell.copierDenies({ program, args, dir, isAbout });
    }

    if (ManifestShell.decompressDenies({ program, args, dir, isAbout })) {
      return true;
    }

    switch (program) {
      case 'tar':
      case 'bsdtar': {
        return ManifestShell.tarDenies({ args, dir, isAbout });
      }
      case 'unzip': {
        return ManifestShell.unzipDenies({ args, dir, isAbout });
      }
      case 'zip': {
        return ManifestShell.zipDenies({ args, dir, isAbout });
      }
      case 'find': {
        return ManifestShell.findDenies({ args, dir, isAbout });
      }
      default: {
        break;
      }
    }

    const unpack = ManifestShell.unpackFolderOf({ program, args, dir });

    if (unpack !== undefined) {
      return ManifestShell.extractsInto({ folder: unpack, members: [], dir, isAbout });
    }

    const refs = ManifestShell.refsOf({ program, args, dir, isAbout });

    if (program === 'mv') {
      return refs.length > 0;
    }

    if (
      refs.length > 0 &&
      ManifestShell.FILTERS.has(program) &&
      ManifestShell.isInPlace({ program, args })
    ) {
      return true;
    }

    // A script that names the file and writes (`w file`, `e cmd`, a redirect) is not just reading.
    if (
      ManifestShell.FILTERS.has(program) &&
      args.some((word) =>
        InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) }),
      ) &&
      ManifestShell.scriptWrites({ program, args })
    ) {
      return true;
    }

    if (
      InlineScript.scriptOf({ program, args: [], heredoc: undefined, skip: [] }) !== undefined ||
      ManifestShell.RUNNERS.has(program)
    ) {
      return ManifestShell.runnerDenies({ command, call, line, dir, refs, context });
    }

    if (refs.length === 0) {
      return false;
    }

    // A stream editor whose script names the file is not just reading.
    if (
      ManifestShell.FILTERS.has(program) &&
      args.some(
        (word) =>
          InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) }) &&
          !refs.some((ref) => args[ref.index] === word),
      )
    ) {
      return true;
    }

    return !ManifestShell.isReader({ program, args });
  }

  /** Whether any command of the line names the manifest or its folder, as a word or a redirect, or holds the bare name of the file. */
  private static lineHasRef(opts: {
    commands: ISimpleCommand[];
    dir: string;
    isAbout: boolean;
  }): boolean {
    return opts.commands.some((command) => {
      const call = ManifestShell.callOf({ command });
      const words = [...call.args, ...command.redirects];

      return words.some((word) => {
        const value = word.slice(word.indexOf('=') + 1);

        return (
          basename(value).toLowerCase() === ManifestPath.NAME ||
          ManifestShell.classify({ word: value, dir: opts.dir, isAbout: opts.isAbout }) !==
            undefined
        );
      });
    });
  }

  /** Strips the comments of a command line: a `#` that starts a word, outside quotes and heredocs. */
  private static stripComments(opts: { line: string }): string {
    if (!opts.line.includes('#')) {
      return opts.line;
    }

    const kept: string[] = [];
    let quote: string | undefined;
    let heredoc: { end: string; isIndented: boolean } | undefined;

    for (const text of opts.line.split('\n')) {
      if (heredoc !== undefined) {
        kept.push(text);
        heredoc = (heredoc.isIndented ? text.trim() : text) === heredoc.end ? undefined : heredoc;

        continue;
      }

      let cut = -1;

      for (let index = 0; index < text.length && cut === -1; index += 1) {
        const char = text[index] ?? '';

        if (quote !== undefined) {
          if (char === '\\' && quote === '"') {
            index += 1;
          } else if (char === quote) {
            quote = undefined;
          }
        } else if (char === '\\') {
          index += 1;
        } else if (char === "'" || char === '"') {
          quote = char;
        } else if (char === '#' && (index === 0 || /[\s;|&(]/.test(text[index - 1] ?? ''))) {
          cut = index;
        }
      }

      const code = cut === -1 ? text : text.slice(0, cut);
      const start = quote === undefined ? /<<(-?)\s*["']?([A-Za-z_]\w*)["']?/.exec(code) : null;

      kept.push(code);

      if (start !== null) {
        heredoc = { end: start[2] ?? '', isIndented: start[1] === '-' };
      }
    }

    return kept.join('\n');
  }

  /** What `printf` or `echo` prints, as far as it can be told from its words. */
  private static printedBy(opts: { call: ICall }): string {
    const { program, args } = opts.call;
    const words = args.filter(
      (word, index) => program !== 'echo' || index > 0 || !/^-[neE]+$/.test(word),
    );

    if (program === 'echo') {
      return words.join(' ');
    }

    const [format = '', ...values] = words;
    let used = 0;
    const text = format.replace(/%(?:%|[-0-9.]*[a-zA-Z])/g, (match) => {
      if (match === '%%') {
        return '%';
      }

      used += 1;

      return values[used - 1] ?? '';
    });

    return [text, ...values.slice(used)].join(' ').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }

  /** Whether a shell that reads its commands from what another command prints runs something that changes the manifest. */
  private static feedsShell(opts: {
    commands: ISimpleCommand[];
    index: number;
    dir: string;
    context: ILine;
  }): boolean {
    const { commands, index, context } = opts;
    const call = ManifestShell.callOf({
      command: commands[index] ?? { words: [], redirects: [], assignments: [] },
    });
    // A process substitution is what the shell reads, not a file it opens: the commands next to it feed it.
    const hasFile = call.args.some((word) => !word.startsWith('-') && !/^[<>]\(/.test(word));
    const hasString = call.args.some((word) => /^-[A-Za-z]*c$/.test(word));
    const isReading =
      ((ManifestShell.SHELLS.has(call.program) && !hasFile && !hasString) ||
        call.program === '.' ||
        call.program === 'source') &&
      !hasFile;

    if (!isReading) {
      return false;
    }

    const feeders = [commands[index - 1], commands[index + 1]]
      .filter((command): command is ISimpleCommand => command !== undefined)
      .map((command) => ManifestShell.callOf({ command }))
      .filter((feeder) => ManifestShell.SHELL_FEEDERS.has(feeder.program));

    // What is fed is not written out: it is not let through when the line is about `.agents`.
    if (feeders.length === 0) {
      return context.isAbout;
    }

    return feeders.some((feeder) => {
      const text = ManifestShell.printedBy({ call: feeder });

      return PathPattern.hasExpansion({ word: text })
        ? context.isAbout
        : ManifestShell.inspectLine({
            line: text,
            dir: opts.dir,
            cwd: context.cwd,
            depth: context.depth + 1,
          });
    });
  }

  /** The glob options a line sets with `shopt -s`. */
  private static globsOf(opts: { line: string }): { dotglob: boolean; globstar: boolean } {
    const set = Array.from(
      opts.line.matchAll(/\bshopt\s+-s\s+([A-Za-z_ ]+)/g),
      (match) => match[1] ?? '',
    ).join(' ');

    return { dotglob: /\bdotglob\b/.test(set), globstar: /\bglobstar\b/.test(set) };
  }

  /** Whether a command line changes the manifest. `dir` is the folder it runs in; `cwd` is the tool's own. */
  static inspectLine(opts: {
    line: string;
    dir: string;
    cwd: string | undefined;
    depth: number;
  }): boolean {
    if (opts.depth > ManifestShell.MAX_DEPTH) {
      return InlineScript.writesInUnreadLine({ line: opts.line });
    }

    const line = ManifestShell.stripComments({ line: opts.line });
    const parsed = ShellParser.parseChecked({ command: line });

    // A line the parser did not read in full is not let through when it can write where the manifest is.
    if (parsed.isOverBudget) {
      return InlineScript.writesInUnreadLine({ line });
    }

    const context: ILine = {
      cwd: opts.cwd,
      depth: opts.depth,
      isAbout: ManifestShell.isAboutFolder({ commands: parsed.commands, line, dir: opts.dir }),
      startDir: opts.dir,
      stashMoves: 0,
    };
    const globs = ManifestShell.globsOf({ line });
    const saved = ManifestShell.view;
    let dir = opts.dir;
    let previous = opts.dir;
    let known: boolean | undefined;

    try {
      for (const [index, command] of parsed.commands.entries()) {
        const here = dir;
        const hasRef = (): boolean => {
          known =
            known ??
            ManifestShell.lineHasRef({
              commands: parsed.commands,
              dir: here,
              isAbout: context.isAbout,
            });

          return known;
        };

        ManifestShell.view = { previous, ...globs };

        if (
          ManifestShell.inspectSimple({ command, line, dir, context, hasRef }) ||
          ManifestShell.feedsShell({ commands: parsed.commands, index, dir, context })
        ) {
          return true;
        }

        ({ dir, previous } = ManifestShell.folderAfter({
          call: ManifestShell.callOf({ command }),
          dir,
          previous,
          isAbout: context.isAbout,
        }));
      }

      return false;
    } finally {
      ManifestShell.view = saved;
    }
  }
}
