import { ConfigConstants } from '../config/common/index.ts';
import { LinkMakers } from './link-makers.ts';
import { ProtectedNames } from './protected-names.ts';
import { ShellPrograms } from './shell-programs.ts';
import type { IOptionValues, ISimpleCommand, IWriteTarget } from './common/index.ts';
import { ShellArgumentUtility } from './utilities/shell-argument.utility.ts';
import { WriteTargets } from './write-targets.ts';

/** The programs an `-exec` of `find` may run that write or move the files they are given, besides the removers. */
const FIND_WRITERS = new Set(['mv', 'cp', 'truncate', 'tee', 'dd', 'ln', 'install', 'rsync']);

export class ShellWrites {
  /** curl's short options that take a value; every other letter is a switch (`-sL`). */
  private static readonly CURL_VALUED_SHORT = 'AbcCdDeEFHKmoPQrtTuUwxXyYz';

  /** What the options of the programs that name a destination take as values, so a value is not read as the destination. */
  private static readonly VALUES: Readonly<Record<string, IOptionValues>> = {
    cp: { shorts: 'St', longs: ['--suffix', '--target-directory'] },
    mv: { shorts: 'St', longs: ['--suffix', '--target-directory'] },
    ln: { shorts: 'St', longs: ['--suffix', '--target-directory'] },
    install: {
      shorts: 'gmoSt',
      longs: ['--group', '--mode', '--owner', '--suffix', '--target-directory', '--strip-program'],
    },
    rsync: {
      shorts: 'efBMT@',
      longs: [
        '--rsh',
        '--rsync-path',
        '--exclude',
        '--exclude-from',
        '--include',
        '--include-from',
        '--filter',
        '--files-from',
        '--backup-dir',
        '--suffix',
        '--log-file',
        '--log-file-format',
        '--out-format',
        '--port',
        '--bwlimit',
        '--partial-dir',
        '--temp-dir',
        '--compare-dest',
        '--copy-dest',
        '--link-dest',
        '--chmod',
        '--chown',
        '--usermap',
        '--groupmap',
        '--timeout',
        '--contimeout',
        '--max-size',
        '--min-size',
        '--max-delete',
        '--modify-window',
        '--block-size',
        '--compress-level',
        '--skip-compress',
        '--compress-choice',
        '--checksum-choice',
        '--iconv',
        '--password-file',
        '--read-batch',
        '--write-batch',
        '--only-write-batch',
        '--address',
        '--sockopts',
        '--info',
        '--debug',
        '--stop-after',
        '--stop-at',
        '--protocol',
        '--copy-as',
        '--early-input',
        '--outbuf',
        '--remote-option',
      ],
    },
  };

  /** The programs that remove or empty the files they are given. */
  private static readonly REMOVERS = new Set(['rm', 'unlink', 'rmdir', 'shred']);

  /** The `git` subcommands that remove, move or restore the files they are given. */
  private static readonly GIT_FILE_COMMANDS = new Set(['rm', 'mv', 'restore', 'checkout']);

  /**
   * The words of a command that removes, moves away or edits in place the files it names: `rm`, `unlink`, `rmdir`, `shred`,
   * `truncate`, `sed -i`, `perl -i`, the sources of `mv`, and `git rm`, `git mv`, `git restore` and `git checkout`. Each non-option
   * word is a candidate; the guard keeps only those that are a file it protects.
   */
  private static protectedWordsOf(opts: {
    name: string;
    args: string[];
    values?: IOptionValues;
  }): { word: string; message: string; isEdit?: boolean }[] {
    const { name, args } = opts;
    const words = (list: string[]): string[] => list.filter((word) => !word.startsWith('-'));
    const named = (list: string[], what: string): { word: string; message: string }[] =>
      words(list).map((word) => ({ word, message: `${what} ${word}` }));
    const edited = (
      list: string[],
      what: string,
    ): { word: string; message: string; isEdit: true }[] =>
      list.map((word) => ({ word, message: `${what} ${word}`, isEdit: true }));

    if (ShellWrites.REMOVERS.has(name)) {
      return named(args, `${name} removes or empties`);
    }

    if (name === 'truncate') {
      return edited(
        ShellArgumentUtility.positional({
          args,
          values: { shorts: 'sr', longs: ['--size', '--reference'] },
        }),
        'truncate empties or resizes',
      );
    }

    if (
      name === 'sed' &&
      args.some(
        (word) =>
          word === '--in-place' || word.startsWith('--in-place=') || /^-[a-zA-Z]*i/.test(word),
      )
    ) {
      const values = { shorts: 'efl', longs: ['--expression', '--file', '--line-length'] };
      const files = ShellArgumentUtility.positional({ args, values });
      const hasScriptOption =
        ShellArgumentUtility.valueOf({
          args,
          long: ['--expression', '--file'],
          short: ['e', 'f'],
          valued: 'efl',
        }) !== undefined;

      // The first word is the script unless an option gave it.
      return edited(hasScriptOption ? files : files.slice(1), 'sed edits in place');
    }

    if (name === 'perl' && args.some((word) => /^-[a-zA-Z]*i/.test(word))) {
      const files = ShellArgumentUtility.positional({ args, values: { shorts: 'eEI', longs: [] } });
      const hasCode =
        ShellArgumentUtility.valueOf({ args, short: ['e', 'E'], valued: 'eEI' }) !== undefined;

      return edited(hasCode ? files : files.slice(1), 'perl edits in place');
    }

    if (name === 'mv') {
      const directory = ShellArgumentUtility.valueOf({
        args,
        long: ['--target-directory'],
        short: ['t'],
        valued: opts.values?.shorts,
      });
      const sources = ShellArgumentUtility.positional({ args, values: opts.values });

      return named(directory === undefined ? sources.slice(0, -1) : sources, 'mv moves away');
    }

    if (name === 'git') {
      const { rest } = WriteTargets.gitArguments({ args });
      const [sub, ...after] = rest;

      return sub !== undefined && ShellWrites.GIT_FILE_COMMANDS.has(sub)
        ? named(after, `git ${sub} changes`)
        : [];
    }

    return [];
  }

  /**
   * The files a `vulcan` command writes that the guards protect: the config for `config format` (it writes unless it is given `--check`),
   * for `config codemod ... --write` and for `migrate apply`, with the first module for the codemods. The program is `vulcan` itself, or `bun`, `node` or
   * `bunx` given a path or a name that ends in `vulcan`.
   */
  private static vulcanWritesOf(opts: { name: string; args: string[] }): string[] {
    const at =
      opts.name === 'vulcan'
        ? -1
        : opts.args
            .slice(0, 3)
            .findIndex(
              (word) => ShellPrograms.basenameOf({ word }).replace(/@[^/]*$/, '') === 'vulcan',
            );

    if (
      opts.name !== 'vulcan' &&
      (at === -1 || !['bun', 'bunx', 'node', 'npx'].includes(opts.name))
    ) {
      return [];
    }

    const [scope, action, ...rest] = opts.args.slice(at + 1);
    const config = `${ConfigConstants.DIRECTORY}/${ConfigConstants.FILE}`;

    // `migrate apply` runs the codemods of a migration, which write the config (and stage what they wrote): an owner's command.
    if (scope === 'migrate' && action === 'apply') {
      return [config, `${ConfigConstants.DIRECTORY}/vulcan/index.mts`];
    }

    if (scope !== 'config') {
      return [];
    }

    if (action === 'format' && !rest.includes('--check')) {
      return [config];
    }

    return action === 'codemod' && rest.includes('--write')
      ? [config, `${ConfigConstants.DIRECTORY}/vulcan/index.mts`]
      : [];
  }

  /**
   * Whether an `-exec`, `-execdir`, `-ok` or `-okdir` of `find` runs a program that removes, moves, copies or edits what it is given
   * (`sed` and `perl` only with an in-place option).
   */
  private static findRunsWriter(opts: { args: string[] }): boolean {
    const { args } = opts;

    return args.some((word, index) => {
      if (!['-exec', '-execdir', '-ok', '-okdir'].includes(word)) {
        return false;
      }

      const rest = args.slice(index + 1);
      const end = rest.findIndex((item) => item === ';' || item === '+');
      const run = end === -1 ? rest : rest.slice(0, end);
      const program = ShellPrograms.basenameOf({ word: run[0] ?? '' });

      if (ShellWrites.REMOVERS.has(program) || FIND_WRITERS.has(program)) {
        return true;
      }

      return (
        (program === 'sed' || program === 'perl') &&
        run.some(
          (item) =>
            item === '--in-place' || item.startsWith('--in-place=') || /^-[a-zA-Z]*i/.test(item),
        )
      );
    });
  }

  /** `find` with `-delete`, or `-exec` of a program that writes, deletes what it finds under its folders. */
  private static addFind(opts: {
    args: string[];
    base: string;
    targets: IWriteTarget[];
    configModules: string[];
  }): void {
    const { args, base, targets } = opts;
    const isDeleting = args.includes('-delete') || ShellWrites.findRunsWriter({ args });

    if (!isDeleting) {
      return;
    }

    // `-name '*.log' -delete` deletes only what the pattern matches: with nothing else in the expression that widens it, that is the whole reach.
    const names = args.flatMap((word, index) =>
      ['-name', '-iname'].includes(word) ? [args[index + 1] ?? '*'] : [],
    );
    const isNarrow =
      names.length > 0 &&
      !args.some((word) =>
        ['-o', '-or', '!', '-not', '(', '-path', '-ipath', '-regex'].includes(word),
      );

    if (
      isNarrow &&
      !names.some((pattern) =>
        ProtectedNames.isNameReachable({ pattern, configModules: opts.configModules }),
      )
    ) {
      return;
    }

    const roots: string[] = [];

    for (const word of args) {
      if (['-H', '-L', '-P'].includes(word)) {
        continue;
      }

      if (word.startsWith('-') || word === '!' || word === '(' || word === ',') {
        break;
      }

      roots.push(word);
    }

    for (const root of roots.length === 0 ? ['.'] : roots) {
      targets.push({
        word: root,
        base,
        message: `find deletes under ${root}`,
        isProtectedOnly: true,
        isIntoFolder: true,
        isLinkName: true,
      });
    }
  }

  /** The words a simple command would create or write, with a name for what writes them. */
  static targetsOf(opts: {
    command: ISimpleCommand;
    base: string;
    tmp: string;
    /** The modules the config imports (`guard.configModules`): a `find -name` of one of their names reaches them. */
    configModules?: string[];
  }): IWriteTarget[] {
    const program = ShellPrograms.programOf({ command: opts.command });
    const name = ShellPrograms.basenameOf({ word: program.name });
    const { base } = opts;
    // The shell expands braces before the program sees its words: `{-t,/etc}` is `-t /etc`, so the options are read after.
    const redirected = opts.command.redirects.map((word) => ({
      word,
      ...ShellArgumentUtility.bracedWordsOf({ word }),
    }));
    const braced = program.args.map((word) => ShellArgumentUtility.bracedWordsOf({ word }));
    // Bash drops an empty branch (`{,/etc}` is the one word `/etc`).
    const args = braced.flatMap((entry) =>
      entry.words.length > 1 ? entry.words.filter((word) => word !== '') : entry.words,
    );
    const isUnread = [...redirected, ...braced].some((entry) => entry.isUnread);
    const targets: IWriteTarget[] = redirected.flatMap(({ word, words }) =>
      words.map((expanded) => ({
        word: expanded,
        base,
        message: `a shell redirect writes ${expanded}`,
        isAmbiguous: opts.command.copies?.includes(word) === true,
        isRedirect: true,
      })),
    );
    const assignments = [
      ...opts.command.assignments,
      ...(['export', 'declare', 'typeset', 'local', 'readonly'].includes(name) ? args : []),
    ];

    // A prefix assignment (`TMPDIR={a,b} cmd`) is not expanded for braces; the arguments of `export` and the like are.
    const assigned: IWriteTarget[] = [];

    for (const assignment of assignments.filter((word) => word.startsWith('TMPDIR='))) {
      assigned.push({
        word: assignment.slice('TMPDIR='.length),
        base,
        message: 'TMPDIR points outside the project',
      });
    }

    const values = ShellWrites.VALUES[name];
    const maker = LinkMakers.of({ name, args });
    const last = ShellArgumentUtility.positional({ args, values }).at(-1);
    const add = (word: string, message: string): number => targets.push({ word, base, message });

    if (['mkdir', 'touch'].includes(name)) {
      for (const word of ShellArgumentUtility.positional({ args })) {
        add(word, `${name} creates ${word}`);
      }
    } else if (['cp', 'mv', 'install', 'ln', 'rsync', 'link'].includes(name)) {
      // `-t` names the destination of `cp`, `mv`, `install` and `ln`; in `rsync` it is `--times`.
      const directory =
        name === 'rsync'
          ? undefined
          : ShellArgumentUtility.valueOf({
              args,
              long: ['--target-directory'],
              short: ['t'],
              valued: values?.shorts,
            });

      const before = targets.length;

      if (directory !== undefined) {
        add(directory, `${name} writes into ${directory}`);
      } else if (last !== undefined) {
        add(last, `${name} writes ${last}`);
      }

      // What `mv`, `rsync`, `ln` and a recursive `cp` put at the destination may replace it: a folder named so is the folder.
      const isReplacing =
        ['mv', 'rsync', 'ln'].includes(name) ||
        (name === 'cp' &&
          args.some(
            (word) =>
              word === '--recursive' ||
              word === '--archive' ||
              (/^-[a-zA-Z]+$/.test(word) && /[rRa]/.test(word)),
          ));
      const put = targets[before];

      if (isReplacing && put !== undefined) {
        targets[before] = { ...put, isPut: true };
      }

      for (const word of values === undefined
        ? []
        : ShellArgumentUtility.wordsBeforeUnknownOptions({ args, values })) {
        if (word !== last) {
          add(
            word,
            `${name} may write ${word}: an option it does not know could take what follows`,
          );
        }
      }

      for (const word of maker?.hardSources ?? []) {
        targets.push({
          word,
          base,
          message: `${name} links to ${word}`,
          isLinkSource: true,
          isAmbiguous: true,
        });
      }

      // What the command reads may be a link the line made: a copy or a move carries a relative link somewhere else.
      const words = ShellArgumentUtility.positional({ args, values });
      const readFrom = directory !== undefined || words.length < 2 ? words : words.slice(0, -1);
      const destination = directory ?? last;

      if (destination !== undefined && (directory !== undefined || words.length >= 2)) {
        WriteTargets.addPutInto({ name, args, destination, sources: readFrom, base, targets });
      }

      for (const word of readFrom) {
        targets.push({ word, base, message: `${name} reads ${word}`, isLinkRead: true });
      }
    } else if (name === 'tee') {
      for (const word of ShellArgumentUtility.positional({ args })) {
        add(word, `tee writes ${word}`);
      }
    } else if (name === 'tar') {
      WriteTargets.addTar({ args, base, targets });
    } else if (name === 'unzip') {
      WriteTargets.addUnzip({ args, base, targets });
    } else if (name === 'find') {
      ShellWrites.addFind({ args, base, targets, configModules: opts.configModules ?? [] });
    } else if (name === 'dd') {
      const output = args.find((word) => word.startsWith('of='));

      if (output !== undefined) {
        add(output.slice(3), `dd writes ${output.slice(3)}`);
      }
    } else if (name === 'curl') {
      const output = ShellArgumentUtility.valueOf({
        args,
        long: ['--output'],
        short: ['o'],
        valued: ShellWrites.CURL_VALUED_SHORT,
      });
      const directory = ShellArgumentUtility.valueOf({ args, long: ['--output-dir'] });

      if (output !== undefined) {
        add(output, `curl saves to ${output}`);
      }

      if (directory !== undefined) {
        add(directory, `curl saves into ${directory}`);
      }
    } else if (name === 'wget') {
      const valued = 'aoeTtwQiBIXARDlUPO';
      const output = ShellArgumentUtility.valueOf({
        args,
        long: ['--output-document'],
        short: ['O'],
        valued,
      });
      const directory = ShellArgumentUtility.valueOf({
        args,
        long: ['--directory-prefix'],
        short: ['P'],
        valued,
      });

      for (const word of [output, directory]) {
        if (word !== undefined) {
          add(word, `wget saves to ${word}`);
        }
      }
    } else if (name === 'mktemp') {
      const directory = ShellArgumentUtility.valueOf({
        args,
        long: ['--tmpdir'],
        short: ['p'],
        valued: 'p',
      });
      const inTmpdir = args.some((word) => /^-[a-zA-Z]*t[a-zA-Z]*$/.test(word));
      const [template] = ShellArgumentUtility.positional({ args }).filter(
        (word) => word !== directory,
      );

      if (directory !== undefined) {
        add(directory, 'mktemp creates a temporary file');
      } else if (inTmpdir || template === undefined) {
        add(opts.tmp, 'mktemp creates a file in the system temp directory');
      } else {
        add(template, 'mktemp creates a temporary file');
      }
    } else if (name === 'git') {
      const { rest, dir } = WriteTargets.gitArguments({ args });

      targets.push(...WriteTargets.gitTargets({ rest, base, dir }));

      // `git -C <dir>` runs in that folder, which may be reached through a link the line made.
      if (dir !== undefined) {
        targets.push({ word: dir, base, message: `git runs in ${dir}`, isLinkRead: true });
      }
    }

    // A removal or an in-place edit makes nothing outside the project, but it is how an agent loosens a guard.
    for (const { word, message, isEdit } of ShellWrites.protectedWordsOf({ name, args, values })) {
      targets.push(
        isEdit === true
          ? { word, base, message, isEdit: true }
          : { word, base, message, isProtectedOnly: true },
      );
    }

    // `vulcan config format`, `vulcan config codemod ... --write` and `vulcan migrate apply` write the config and its modules: an agent never runs them.
    for (const word of ShellWrites.vulcanWritesOf({ name, args })) {
      targets.push({ word, base, message: `vulcan writes ${word}`, isEdit: true });
    }

    const own = maker !== undefined && maker.names.length > 0 ? maker.destination : undefined;

    return [...assigned, ...targets]
      .map((target) =>
        own !== undefined &&
        target.word === own &&
        target.isLinkSource !== true &&
        target.isLinkRead !== true
          ? { ...target, isLinkName: true }
          : target,
      )
      .map((target) => (isUnread ? { ...target, hasUnreadBrace: true } : target));
  }
}
