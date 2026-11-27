import { resolve } from 'node:path';
import type { IWriteTarget } from './common/index.ts';
import { ShellArgumentUtility } from './utilities/shell-argument.utility.ts';

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

/** The paths a git, tar or unzip call, or a copy into a folder, writes. */
export class WriteTargets {
  /** Words after `git`'s global options (`-C dir`, `-c k=v`, `--no-pager`) and the directory `-C` names. */
  static gitArguments(opts: { args: string[] }): { rest: string[]; dir: string | undefined } {
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
  }

  static gitTargets(opts: {
    rest: string[];
    base: string;
    dir: string | undefined;
  }): IWriteTarget[] {
    const base = opts.dir === undefined ? opts.base : resolve(opts.base, opts.dir);
    const [sub, second] = ShellArgumentUtility.positional({ args: opts.rest });

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
  static addPutInto(opts: {
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
      if (WriteTargets.isUnknownName({ word: source, isRsync })) {
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
  static addTar(opts: { args: string[]; base: string; targets: IWriteTarget[] }): void {
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
        : ShellArgumentUtility.valueOf({ args, long: ['--file'], short: ['f'], valued });
    const directory = ShellArgumentUtility.valueOf({
      args,
      long: ['--directory'],
      short: ['C'],
      valued,
    });

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
  static addUnzip(opts: { args: string[]; base: string; targets: IWriteTarget[] }): void {
    const { args, base, targets } = opts;

    if (args.some((word) => /^-[a-zA-Z]*[ltpvcZ]/.test(word) && !word.startsWith('--'))) {
      return;
    }

    const into = ShellArgumentUtility.valueOf({ args, short: ['d'], valued: 'dxP' }) ?? '.';

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
}
