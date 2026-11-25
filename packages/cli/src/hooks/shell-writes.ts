import { resolve } from 'node:path';
import { ConfigConstants } from '../config/common/index.ts';
import { LinkMakers } from './link-makers.ts';
import { ProtectedNames } from './protected-names.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

/** A path a command writes, and the folder it is taken from. */
export interface IWriteTarget {
  word: string;
  message: string;
  /** The directory a relative `word` is taken from: the hook's, moved by `cd` and `git -C`. */
  base: string;
  /** What `$PWD` is in `word`: the shell's folder, moved by `cd` but not by `git -C`; undefined when it is not known. */
  pwd?: string;
  /** The plain variables the same shell set earlier on the line. */
  vars?: Record<string, string>;
  /** False after a `cd` the guard could not work out: `base` is then only the last folder it knew. */
  isKnown?: boolean;
  /** `>&word` with an expansion in it: a file, or a descriptor held in a variable. */
  isAmbiguous?: boolean;
  /** The target of a shell redirect. */
  isRedirect?: boolean;
  /** The word has a brace the guard cannot expand into its branches, so where it writes is not known. */
  hasUnreadBrace?: boolean;
  /** What a hard link of the line (`ln`, `cp -l`) links to, not a file it writes: the same file, so outside the project is outside. */
  isLinkSource?: boolean;
  /** What `cp`, `mv`, `rsync`, `install` or `ln` reads: not a write, but a link made on the line would be copied or moved by it. */
  isLinkRead?: boolean;
  /** The name a link is made at (or the folder it is made in): it is the command's own, so it is not a path through an earlier link. */
  isLinkName?: boolean;
  /** The absolute names of the symbolic links the line made before this command. */
  links?: string[];
  /** The line made a symbolic link this check could not name, so any path after it may go through one. */
  hasUnknownLink?: boolean;
  /** A `$` of the word was quoted or escaped: it is a character, and the word's text reads it as a variable. */
  hasLiteralDollar?: boolean;
  /**
   * A removal or an in-place edit (`rm`, `sed -i`, `mv` of a source...): it creates nothing, so only a file the guards read
   * their policy from counts. Every other path of such a word is left to the owner.
   */
  isProtectedOnly?: boolean;
  /** Like `isProtectedOnly`, for one name put into a folder (`cp f dir` writes `dir/f`): only the file itself counts, not a folder above it. */
  isNameInFolder?: boolean;
  /** A folder that things are put into, or deleted from, under names this check cannot tell: it counts when it holds a file the guards read. */
  isIntoFolder?: boolean;
  /** The destination of a command that may replace it whole (`mv`, `rsync`, `ln`, a recursive `cp`): the folder `node_modules` counts, which a file write does not. */
  isPut?: boolean;
  /** An edit in place (`sed -i`, `perl -i`, `truncate`): a write like a redirect, and a pattern in it is judged by what it can reach. */
  isEdit?: boolean;
}

/** The most words one word may make of its brace lists before the guard stops expanding it. */
const MAX_BRACE_WORDS = 64;

/** The `}` that closes the `{` at `open`, and the top-level commas between them; -1 when it never closes. */
const braceGroupAt = (opts: {
  word: string;
  open: number;
}): { close: number; commas: number[] } => {
  const commas: number[] = [];
  let depth = 0;

  for (let index = opts.open; index < opts.word.length; index += 1) {
    const char = opts.word[index];

    depth += Number(char === '{') - Number(char === '}');

    if (depth === 0) {
      // Like bash: a `}` closes a list only after a comma or a `..`; before that it is text (`{a},/etc}`).
      if (commas.length > 0 || opts.word.slice(opts.open, index).includes('..')) {
        return { close: index, commas };
      }

      depth = 1;
    }

    if (char === ',' && depth === 1) {
      commas.push(index);
    }
  }

  return { close: -1, commas };
};

/**
 * The words a shell makes of a word with brace lists (`{out,/etc}/x` is `out/x` and `/etc/x`), each branch alone, so a
 * branch outside the project is a target of its own. `{a}` and `{}` stay as written, and a
 * sequence of digits or letters (`{1..3}`) is its first value: it can change no folder. What the guard cannot expand -
 * another sequence of single characters (zsh makes `/` and `0` of `{/..0}`), a word that makes more than
 * `MAX_BRACE_WORDS` words - is kept as written and marked unread.
 */
const bracedWordsOf = (opts: { word: string }): { words: string[]; isUnread: boolean } => {
  const words: string[] = [];
  let isUnread = false;
  const expand = (word: string, from: number): void => {
    // Stops the expansion itself: thirty lists of two make a billion words.
    if (words.length > MAX_BRACE_WORDS) {
      return;
    }

    const open = word.indexOf('{', from);
    const { close, commas } =
      open === -1 ? { close: -1, commas: [] } : braceGroupAt({ word, open });

    if (close === -1) {
      // An unmatched `{` is text, and a list after it is still expanded.
      if (open === -1) {
        words.push(word);
      } else {
        expand(word, open + 1);
      }

      return;
    }

    const [head, tail, inner] = [
      word.slice(0, open),
      word.slice(close + 1),
      word.slice(open + 1, close),
    ];
    const sequence = /^(?:(-?\d+)\.\.-?\d+|([A-Za-z])\.\.[A-Za-z])(?:\.\.-?\d+)?$/.exec(inner);

    if (commas.length > 0) {
      const bounds = [open, ...commas, close];

      for (const [index, start] of bounds.slice(0, -1).entries()) {
        expand(`${head}${word.slice(start + 1, bounds[index + 1])}${tail}`, open);
      }
    } else if (sequence !== null) {
      expand(`${head}${sequence[1] ?? sequence[2]}${tail}`, open);
    } else {
      isUnread ||= /^.\.\..(?:\.\.-?\d+)?$/s.test(inner);
      expand(word, open + 1);
    }
  };

  expand(opts.word, 0);

  return words.length > MAX_BRACE_WORDS
    ? { words: [opts.word], isUnread: true }
    : { words, isUnread };
};

/** The options of a program that take a value, so the word after one is its value and no file of its own. */
interface IOptionValues {
  /** Short options that take a value: `-t DIR`, `-tDIR`, `-vtDIR`. */
  shorts: string;
  /** Long options that take the next word as their value (`--suffix .bak`). */
  longs: readonly string[];
}

/** Whether a short-option cluster ends in an option whose value is the next word (`-t`, `-vt`, not `-tDIR`). */
const takesNext = (opts: { word: string; shorts: string }): boolean => {
  if (!/^-[A-Za-z0-9]/.test(opts.word)) {
    return false;
  }

  const letters = [...opts.word.slice(1)];
  const at = letters.findIndex((letter) => opts.shorts.includes(letter));

  return at === letters.length - 1;
};

/** The words that are not options, and not the values of the options `values` lists; after `--` every word. */
const positional = (opts: { args: string[]; values?: IOptionValues }): string[] => {
  const words: string[] = [];
  let isEnd = false;

  for (let index = 0; index < opts.args.length; index += 1) {
    const word = opts.args[index] ?? '';

    if (!isEnd && word === '--') {
      isEnd = true;
    } else if (isEnd || !word.startsWith('-')) {
      words.push(word);
    } else if (opts.values !== undefined) {
      const isLong = word.startsWith('--');

      if (
        isLong ? opts.values.longs.includes(word) : takesNext({ word, shorts: opts.values.shorts })
      ) {
        index += 1;
      }
    }
  }

  return words;
};

/**
 * The value of an option, long (`--output X`, `--output=X`) or short, next word or attached (`-o X`, `-oX`,
 * `-sLo X`). `valued` lists every short letter of the program that takes a value, so a cluster is cut where
 * its first value starts (`-dofile` is `-d` with the value `ofile`); without it only the letters asked for count.
 */
/** Whether `name` is a long option written short: `--output-doc` for `--output-document`. */
const isPrefixOf = (opts: { name: string; flag: string }): boolean =>
  opts.name.length >= 3 && opts.name.startsWith('--') && opts.flag.startsWith(opts.name);

/**
 * The word before each long option of the program that is not in its table of valued options and has no `=`:
 * what it takes next may be the destination, so the word before it may be too (`cp a dest --sparse never`).
 */
const wordsBeforeUnknownOptions = (opts: { args: string[]; values: IOptionValues }): string[] => {
  const found: string[] = [];
  let last: string | undefined;
  let isEnd = false;

  for (let index = 0; index < opts.args.length; index += 1) {
    const word = opts.args[index] ?? '';

    if (!isEnd && word === '--') {
      isEnd = true;
    } else if (isEnd || !word.startsWith('-')) {
      last = word;
    } else if (word.startsWith('--')) {
      if (opts.values.longs.includes(word)) {
        index += 1;
      } else if (!word.includes('=') && last !== undefined) {
        found.push(last);
      }
    } else if (takesNext({ word, shorts: opts.values.shorts })) {
      index += 1;
    }
  }

  return found;
};

const valueOf = (opts: {
  args: string[];
  long?: string[];
  short?: string[];
  valued?: string;
}): string | undefined => {
  const valued = opts.valued ?? (opts.short ?? []).join('');

  for (const [index, word] of opts.args.entries()) {
    for (const flag of opts.long ?? []) {
      const name = word.split('=')[0] ?? word;

      // getopt takes a unique prefix of a long option for it (`--output-doc`).
      if (name === flag || isPrefixOf({ name, flag })) {
        return word.includes('=') ? word.slice(name.length + 1) : opts.args[index + 1];
      }
    }

    if (/^-[A-Za-z0-9]/.test(word)) {
      const letters = [...word.slice(1)];
      const at = letters.findIndex((letter) => valued.includes(letter));
      const letter = letters[at];

      if (at !== -1 && letter !== undefined && (opts.short ?? []).includes(letter)) {
        const attached = letters.slice(at + 1).join('');

        return attached === '' ? opts.args[index + 1] : attached;
      }
    }
  }

  return undefined;
};
/** Options of `git clone` that take the next word, so it is not the URL or the directory. */
const CLONE_VALUE_FLAGS = new Set([
  '-b',
  '--branch',
  '--depth',
  '-c',
  '--config',
  '-o',
  '--origin',
  '--reference',
  '--separate-git-dir',
  '--template',
  '-j',
  '--jobs',
  '-u',
  '--upload-pack',
  '--filter',
  '--shallow-since',
  '--shallow-exclude',
]);

/** Words after `git`'s global options (`-C dir`, `-c k=v`, `--no-pager`) and the directory `-C` names. */
const gitArguments = (opts: { args: string[] }): { rest: string[]; dir: string | undefined } => {
  let dir: string | undefined;
  let index = 0;

  while (index < opts.args.length && opts.args[index].startsWith('-')) {
    const word = opts.args[index];

    if (word === '-C') {
      dir = opts.args[index + 1];
      index += 2;
    } else if (['-c', '--git-dir', '--work-tree', '--namespace'].includes(word)) {
      index += 2;
    } else {
      index += 1;
    }
  }

  return { rest: opts.args.slice(index), dir };
};

const gitTargets = (opts: {
  rest: string[];
  base: string;
  dir: string | undefined;
}): IWriteTarget[] => {
  const base = opts.dir === undefined ? opts.base : resolve(opts.base, opts.dir);
  const [sub, second] = positional({ args: opts.rest });

  if (sub === 'worktree' && second === 'add') {
    const afterAdd = opts.rest.slice(opts.rest.indexOf('add') + 1);
    const skipped = new Set<number>();

    for (const [index, word] of afterAdd.entries()) {
      if (word === '-b' || word === '-B') {
        skipped.add(index);
        skipped.add(index + 1);
      }
    }

    const path = afterAdd.find((word, index) => !word.startsWith('-') && !skipped.has(index));

    return path === undefined
      ? []
      : [{ word: path, base, message: `git worktree add creates ${path}` }];
  }

  if (sub === 'init') {
    const afterInit = opts.rest.slice(opts.rest.indexOf('init') + 1);
    const valued = new Set([
      '--template',
      '--separate-git-dir',
      '-b',
      '--initial-branch',
      '--object-format',
    ]);
    const words: string[] = [];

    for (let index = 0; index < afterInit.length; index += 1) {
      if (valued.has(afterInit[index] ?? '')) {
        index += 1;
      } else if (!(afterInit[index] ?? '').startsWith('-')) {
        words.push(afterInit[index] ?? '');
      }
    }

    const directory = words.at(-1) ?? '.';

    return [{ word: directory, base, message: `git init creates a repository in ${directory}` }];
  }

  if (sub === 'clean') {
    const afterClean = opts.rest.slice(opts.rest.indexOf('clean') + 1);
    const flags = afterClean
      .filter((word) => /^-[A-Za-z]/.test(word) && !word.startsWith('--'))
      .join('');
    const isIgnored = flags.includes('x') || flags.includes('X');

    if (!isIgnored || flags.includes('n') || afterClean.includes('--dry-run')) {
      return [];
    }

    const pathspecs: string[] = [];

    for (let index = 0; index < afterClean.length; index += 1) {
      const word = afterClean[index] ?? '';

      if (word === '-e' || word === '--exclude') {
        index += 1;
      } else if (!word.startsWith('-') || word === '--') {
        if (word !== '--') {
          pathspecs.push(word);
        }
      }
    }

    return (pathspecs.length === 0 ? ['.'] : pathspecs).map((word) => ({
      word,
      base,
      message: `git clean removes the files git ignores under ${word}`,
      isProtectedOnly: true,
      isIntoFolder: true,
      isLinkName: true,
    }));
  }

  if (sub === 'clone') {
    const afterClone = opts.rest.slice(opts.rest.indexOf('clone') + 1);
    const words: string[] = [];

    for (let index = 0; index < afterClone.length; index += 1) {
      if (CLONE_VALUE_FLAGS.has(afterClone[index])) {
        index += 1;
      } else if (!afterClone[index].startsWith('-')) {
        words.push(afterClone[index]);
      }
    }

    const [, destination] = words;

    return words.length === 0
      ? []
      : [
          {
            word: destination ?? '.',
            base,
            message:
              destination === undefined
                ? 'git clone writes into the current directory'
                : `git clone writes ${destination}`,
          },
        ];
  }

  return [];
};

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
        positional({ args, values: { shorts: 'sr', longs: ['--size', '--reference'] } }),
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
      const files = positional({ args, values });
      const hasScriptOption =
        valueOf({ args, long: ['--expression', '--file'], short: ['e', 'f'], valued: 'efl' }) !==
        undefined;

      // The first word is the script unless an option gave it.
      return edited(hasScriptOption ? files : files.slice(1), 'sed edits in place');
    }

    if (name === 'perl' && args.some((word) => /^-[a-zA-Z]*i/.test(word))) {
      const files = positional({ args, values: { shorts: 'eEI', longs: [] } });
      const hasCode = valueOf({ args, short: ['e', 'E'], valued: 'eEI' }) !== undefined;

      return edited(hasCode ? files : files.slice(1), 'perl edits in place');
    }

    if (name === 'mv') {
      const directory = valueOf({
        args,
        long: ['--target-directory'],
        short: ['t'],
        valued: opts.values?.shorts,
      });
      const sources = positional({ args, values: opts.values });

      return named(directory === undefined ? sources.slice(0, -1) : sources, 'mv moves away');
    }

    if (name === 'git') {
      const { rest } = gitArguments({ args });
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
              (word) => ShellParser.basenameOf({ word }).replace(/@[^/]*$/, '') === 'vulcan',
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

  /** A source word whose name this check cannot tell: a pattern, an expansion, `.`, `..`, or (for `rsync`) a trailing slash, which copies what is inside. */
  private static isUnknownName(opts: { word: string; isRsync: boolean }): boolean {
    const bare = opts.word.replace(/\/+$/, '');
    const last = bare.slice(bare.lastIndexOf('/') + 1);

    return (
      /[$*?[`{(~]/.test(opts.word) ||
      last === '' ||
      last === '.' ||
      last === '..' ||
      (opts.isRsync && opts.word.endsWith('/'))
    );
  }

  /**
   * What `cp`, `mv`, `install`, `ln` and `rsync` put into their destination, as names the guards can judge: each source is written
   * at `<destination>/<its name>`, whether the destination is a folder yet or not (the check cannot know what the line makes of it). A
   * source whose name is not known, or a destination taken as a file (`-T`, `ln -n`), writes into the folder under names unknown.
   */
  private static addPutInto(opts: {
    name: string;
    args: string[];
    destination: string;
    sources: string[];
    base: string;
    targets: IWriteTarget[];
  }): void {
    const { name, destination, base, targets } = opts;
    const isRsync = name === 'rsync';
    const folder = destination.replace(/\/+$/, '');
    const isAsFile =
      !isRsync &&
      opts.args.some(
        (word) =>
          word === '--no-target-directory' ||
          word === '--no-dereference' ||
          (/^-[a-zA-Z]+$/.test(word) && /[T]/.test(word)) ||
          (name === 'ln' && /^-[a-zA-Z]+$/.test(word) && word.includes('n')),
      );
    let isUnknown = isAsFile;

    for (const source of opts.sources) {
      if (ShellWrites.isUnknownName({ word: source, isRsync })) {
        isUnknown = true;

        continue;
      }

      const bare = source.replace(/\/+$/, '');
      const entry = bare.slice(bare.lastIndexOf('/') + 1);

      targets.push({
        word: `${folder === '' ? '/' : folder}/${entry}`,
        base,
        message: `${name} writes ${entry} into ${destination}`,
        isProtectedOnly: true,
        isNameInFolder: true,
        isLinkName: true,
      });
    }

    if (isUnknown) {
      targets.push({
        word: destination,
        base,
        message: `${name} writes into ${destination} under names this check cannot tell`,
        isProtectedOnly: true,
        isIntoFolder: true,
        isLinkName: true,
      });
    }
  }

  /** `tar` writes the archive it makes (`-f`) and extracts into `-C` or the current folder, under the names the archive holds. */
  private static addTar(opts: { args: string[]; base: string; targets: IWriteTarget[] }): void {
    const { args, base, targets } = opts;
    const [first = ''] = args;
    // The old style: `tar xf a.tar`, the letters in the first word with no dash.
    const isOldStyle = first !== '' && !first.startsWith('-');
    const letters = [
      ...(isOldStyle ? [first] : []),
      ...args
        .filter((word) => /^-[A-Za-z]/.test(word) && !word.startsWith('--'))
        .map((word) => word.slice(1)),
    ].join('');
    const longs = new Set(
      args.filter((word) => word.startsWith('--')).map((word) => word.split('=')[0]),
    );
    const isExtract = letters.includes('x') || longs.has('--extract') || longs.has('--get');
    const isWriting =
      /[cru]/.test(letters) || ['--create', '--append', '--update'].some((long) => longs.has(long));
    const valued = 'fCbLNTXVKIFg';
    const file =
      isOldStyle && first.includes('f')
        ? args[1]
        : valueOf({ args, long: ['--file'], short: ['f'], valued });
    const directory = valueOf({ args, long: ['--directory'], short: ['C'], valued });

    if (isWriting && file !== undefined && file !== '-') {
      targets.push({ word: file, base, message: `tar writes ${file}` });
    }

    if (isExtract) {
      const into = directory ?? '.';

      targets.push({ word: into, base, message: `tar extracts into ${into}` });
      targets.push({
        word: into,
        base,
        message: `tar extracts into ${into} under the names its archive holds`,
        isProtectedOnly: true,
        isIntoFolder: true,
        isLinkName: true,
      });
    }
  }

  /** `unzip` extracts into `-d` or the current folder, bar the options that only list, test or print. */
  private static addUnzip(opts: { args: string[]; base: string; targets: IWriteTarget[] }): void {
    const { args, base, targets } = opts;

    if (args.some((word) => /^-[a-zA-Z]*[ltpvcZ]/.test(word) && !word.startsWith('--'))) {
      return;
    }

    const into = valueOf({ args, short: ['d'], valued: 'dxP' }) ?? '.';

    targets.push({ word: into, base, message: `unzip extracts into ${into}` });
    targets.push({
      word: into,
      base,
      message: `unzip extracts into ${into} under the names its archive holds`,
      isProtectedOnly: true,
      isIntoFolder: true,
      isLinkName: true,
    });
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
      const program = ShellParser.basenameOf({ word: run[0] ?? '' });

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
    const program = ShellParser.programOf({ command: opts.command });
    const name = ShellParser.basenameOf({ word: program.name });
    const { base } = opts;
    // The shell expands braces before the program sees its words: `{-t,/etc}` is `-t /etc`, so the options are read after.
    const redirected = opts.command.redirects.map((word) => ({ word, ...bracedWordsOf({ word }) }));
    const braced = program.args.map((word) => bracedWordsOf({ word }));
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
    const last = positional({ args, values }).at(-1);
    const add = (word: string, message: string): number => targets.push({ word, base, message });

    if (['mkdir', 'touch'].includes(name)) {
      for (const word of positional({ args })) {
        add(word, `${name} creates ${word}`);
      }
    } else if (['cp', 'mv', 'install', 'ln', 'rsync', 'link'].includes(name)) {
      // `-t` names the destination of `cp`, `mv`, `install` and `ln`; in `rsync` it is `--times`.
      const directory =
        name === 'rsync'
          ? undefined
          : valueOf({ args, long: ['--target-directory'], short: ['t'], valued: values?.shorts });

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

      for (const word of values === undefined ? [] : wordsBeforeUnknownOptions({ args, values })) {
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
      const words = positional({ args, values });
      const readFrom = directory !== undefined || words.length < 2 ? words : words.slice(0, -1);
      const destination = directory ?? last;

      if (destination !== undefined && (directory !== undefined || words.length >= 2)) {
        ShellWrites.addPutInto({ name, args, destination, sources: readFrom, base, targets });
      }

      for (const word of readFrom) {
        targets.push({ word, base, message: `${name} reads ${word}`, isLinkRead: true });
      }
    } else if (name === 'tee') {
      for (const word of positional({ args })) {
        add(word, `tee writes ${word}`);
      }
    } else if (name === 'tar') {
      ShellWrites.addTar({ args, base, targets });
    } else if (name === 'unzip') {
      ShellWrites.addUnzip({ args, base, targets });
    } else if (name === 'find') {
      ShellWrites.addFind({ args, base, targets, configModules: opts.configModules ?? [] });
    } else if (name === 'dd') {
      const output = args.find((word) => word.startsWith('of='));

      if (output !== undefined) {
        add(output.slice(3), `dd writes ${output.slice(3)}`);
      }
    } else if (name === 'curl') {
      const output = valueOf({
        args,
        long: ['--output'],
        short: ['o'],
        valued: ShellWrites.CURL_VALUED_SHORT,
      });
      const directory = valueOf({ args, long: ['--output-dir'] });

      if (output !== undefined) {
        add(output, `curl saves to ${output}`);
      }

      if (directory !== undefined) {
        add(directory, `curl saves into ${directory}`);
      }
    } else if (name === 'wget') {
      const valued = 'aoeTtwQiBIXARDlUPO';
      const output = valueOf({ args, long: ['--output-document'], short: ['O'], valued });
      const directory = valueOf({ args, long: ['--directory-prefix'], short: ['P'], valued });

      for (const word of [output, directory]) {
        if (word !== undefined) {
          add(word, `wget saves to ${word}`);
        }
      }
    } else if (name === 'mktemp') {
      const directory = valueOf({ args, long: ['--tmpdir'], short: ['p'], valued: 'p' });
      const inTmpdir = args.some((word) => /^-[a-zA-Z]*t[a-zA-Z]*$/.test(word));
      const [template] = positional({ args }).filter((word) => word !== directory);

      if (directory !== undefined) {
        add(directory, 'mktemp creates a temporary file');
      } else if (inTmpdir || template === undefined) {
        add(opts.tmp, 'mktemp creates a file in the system temp directory');
      } else {
        add(template, 'mktemp creates a temporary file');
      }
    } else if (name === 'git') {
      const { rest, dir } = gitArguments({ args });

      targets.push(...gitTargets({ rest, base, dir }));

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
