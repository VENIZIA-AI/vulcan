import { basename, join, resolve } from 'node:path';
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
}

interface IRef {
  index: number;
  kind: TPathRef;
}

interface ILine {
  cwd: string | undefined;
  depth: number;
  isAbout: boolean;
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
  ]);
  /** Readers that write a file when given one of these options. */
  static readonly OUTPUT_FLAGS = new Map<string, string[]>([
    ['sort', ['-o', '--output']],
    ['tree', ['-o']],
    ['yq', ['-i', '--inplace']],
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
  /** Sed: a script that writes to a file named in it (`w file`, `s/a/b/w file`). */
  static readonly SED_WRITE = /(?:^|[^a-z0-9])w\s+\S/i;
  static readonly COPIERS = new Set(['cp', 'install', 'rsync', 'ln']);
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

  /** The program of a simple command past the wrappers, with the text it carries for a shell. */
  private static callOf(opts: { command: ISimpleCommand }): ICall {
    const parsed = ShellParser.programOf({ command: opts.command });
    let program = ShellParser.basenameOf({ word: parsed.name });
    let { args } = parsed;
    const nested: string[] = [];
    const isFed =
      parsed.index > 0 &&
      opts.command.words
        .slice(0, parsed.index)
        .some((word) => ShellParser.basenameOf({ word }) === 'xargs');

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

    return { program, args, nested, isFed };
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
          : PathRef.classify({ word: target, dir: opts.dir, isAbout: opts.isAbout });

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

  /** Whether the program, with these arguments, only reads the files it is given. */
  private static isReader(opts: { program: string; args: string[] }): boolean {
    const { program, args } = opts;
    const output = ManifestShell.OUTPUT_FLAGS.get(program);
    const checker = ManifestShell.CHECKERS.get(program);

    if (ManifestShell.FILTERS.has(program)) {
      return !ManifestShell.isInPlace({ program, args });
    }

    if (checker !== undefined) {
      return !args.some((word) => checker.includes(word));
    }

    if (!ManifestShell.READERS.has(program)) {
      return false;
    }

    return (
      output === undefined ||
      !args.some((word) =>
        output.some((flag) => word === flag || (flag === '-o' && word.startsWith('-o'))),
      )
    );
  }

  /** Whether the pathspec-less `find` runs an action on a path that could be the manifest. */
  private static findDenies(opts: { args: string[]; dir: string; isAbout: boolean }): boolean {
    const { args } = opts;

    if (!args.some((word) => ManifestShell.FIND_ACTIONS.has(word))) {
      return false;
    }

    const stop = args.findIndex((word) => word.startsWith('-') || word === '(' || word === '!');
    const starts = stop === -1 ? args : args.slice(0, stop);
    const named = [
      ...new Set(
        args.filter((_word, index) => ManifestShell.FIND_NAME_FILTERS.has(args[index - 1] ?? '')),
      ),
    ];
    // Too many filters to read one by one could be any.
    const filters = named.length > ManifestShell.MAX_FILTERS ? ['*'] : named;
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
        PathRef.classify({ word: start, dir: opts.dir, isAbout: opts.isAbout }) !== undefined ||
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
          PathRef.classify({ word: member, dir: opts.dir, isAbout: opts.isAbout }) !== undefined,
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
      PathRef.classify({ word: archive, dir: opts.dir, isAbout: opts.isAbout }) !== undefined
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
      PathRef.classify({ word, dir, isAbout });

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

  /** Where the shell stands after a simple command: `cd` and `pushd` move it. */
  private static folderAfter(opts: { call: ICall; dir: string; isAbout: boolean }): string {
    const { program, args } = opts.call;
    const target = args.find((word) => !word.startsWith('-'));

    if ((program !== 'cd' && program !== 'pushd') || target === undefined || target === '-') {
      return opts.dir;
    }

    // A folder that is not known, on a line about `.agents`, is taken to be `.agents`.
    if (PathPattern.hasExpansion({ word: target })) {
      return opts.isAbout ? join(opts.dir, ManifestPath.FOLDER) : opts.dir;
    }

    const next = resolve(opts.dir, target);

    return ManifestPath.resolveReal({ path: next }) ?? next;
  }

  private static gitDenies(opts: {
    command: ISimpleCommand;
    call: ICall;
    line: string;
    dir: string;
    isAbout: boolean;
  }): boolean {
    const { args } = opts.call;

    if (
      GitRewrite.rewrites({
        command: opts.command,
        args,
        line: opts.line,
        dir: opts.dir,
        isAbout: opts.isAbout,
      })
    ) {
      return true;
    }

    const { sub } = GitRewrite.subOf({ args });

    // The forms above read their own paths.
    if (['checkout', 'restore', 'apply', 'am', 'read-tree'].includes(sub)) {
      return false;
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
    const hasOutput = args.some((word) => /^--output(?:=|$)/.test(word));

    return hasOutput || !(GitRewrite.READS_PATHS.has(sub) || isStashRead);
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

    // A word the program is given besides its script: whether it only reads it is not known.
    return (
      opts.refs.some((ref) => ref.index !== payload) && !ManifestShell.FILTERS.has(call.program)
    );
  }

  private static inspectSimple(opts: {
    command: ISimpleCommand;
    line: string;
    dir: string;
    context: ILine;
    hasRef: () => boolean;
  }): boolean {
    const { command, line, dir, context } = opts;
    const isAbout = context.isAbout || basename(dir) === ManifestPath.FOLDER;
    const call = ManifestShell.callOf({ command });
    const { program, args } = call;

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
          !target.startsWith('&') && PathRef.classify({ word: target, dir, isAbout }) !== undefined,
      )
    ) {
      return true;
    }

    if (program === 'git') {
      return ManifestShell.gitDenies({ command, call, line, dir, isAbout });
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

    switch (program) {
      case 'tar': {
        return ManifestShell.tarDenies({ args, dir, isAbout });
      }
      case 'unzip': {
        return ManifestShell.unzipDenies({ args, dir, isAbout });
      }
      case 'find': {
        return ManifestShell.findDenies({ args, dir, isAbout });
      }
      default: {
        break;
      }
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

    if (
      program === 'sed' &&
      args.some(
        (word) =>
          ManifestShell.SED_WRITE.test(word) &&
          InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) }),
      )
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

  /** Whether any command of the line names the manifest or its folder, as a word or a redirect. */
  private static lineHasRef(opts: {
    commands: ISimpleCommand[];
    dir: string;
    isAbout: boolean;
  }): boolean {
    return opts.commands.some((command) => {
      const call = ManifestShell.callOf({ command });
      const words = [...call.args, ...command.redirects];

      return words.some(
        (word) =>
          PathRef.classify({
            word: word.slice(word.indexOf('=') + 1),
            dir: opts.dir,
            isAbout: opts.isAbout,
          }) !== undefined,
      );
    });
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

    const parsed = ShellParser.parseChecked({ command: opts.line });

    // A line the parser did not read in full is not let through when it can write where the manifest is.
    if (parsed.isOverBudget) {
      return InlineScript.writesInUnreadLine({ line: opts.line });
    }

    const context: ILine = {
      cwd: opts.cwd,
      depth: opts.depth,
      isAbout: InlineScript.mentionsFolder({ text: opts.line }),
    };
    let dir = opts.dir;
    let known: boolean | undefined;

    for (const command of parsed.commands) {
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

      if (ManifestShell.inspectSimple({ command, line: opts.line, dir, context, hasRef })) {
        return true;
      }

      dir = ManifestShell.folderAfter({
        call: ManifestShell.callOf({ command }),
        dir,
        isAbout: context.isAbout,
      });
    }

    return false;
  }
}
