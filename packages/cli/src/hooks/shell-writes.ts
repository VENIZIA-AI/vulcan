import { resolve } from 'node:path';
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
}

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

      if (isLong ? opts.values.longs.includes(word) : takesNext({ word, shorts: opts.values.shorts })) {
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
const valueOf = (opts: {
  args: string[];
  long?: string[];
  short?: string[];
  valued?: string;
}): string | undefined => {
  const valued = opts.valued ?? (opts.short ?? []).join('');

  for (const [index, word] of opts.args.entries()) {
    for (const flag of opts.long ?? []) {
      if (word === flag) {
        return opts.args[index + 1];
      }

      if (word.startsWith(`${flag}=`)) {
        return word.slice(flag.length + 1);
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

export class ShellWrites {
  /** curl's short options that take a value; every other letter is a switch (`-sL`). */
  static readonly CURL_VALUED_SHORT = 'AbcCdDeEFHKmoPQrtTuUwxXyYz';

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
        '--rsh', '--rsync-path', '--exclude', '--exclude-from', '--include', '--include-from', '--filter',
        '--files-from', '--backup-dir', '--suffix', '--log-file', '--log-file-format', '--out-format',
        '--port', '--bwlimit', '--partial-dir', '--temp-dir', '--compare-dest', '--copy-dest',
        '--link-dest', '--chmod', '--chown', '--usermap', '--groupmap', '--timeout', '--contimeout',
        '--max-size', '--min-size', '--max-delete', '--modify-window', '--block-size',
        '--compress-level', '--skip-compress', '--compress-choice', '--checksum-choice', '--iconv',
        '--password-file', '--read-batch', '--write-batch', '--only-write-batch', '--address',
        '--sockopts', '--info', '--debug', '--stop-after', '--stop-at', '--protocol', '--copy-as',
        '--early-input', '--outbuf', '--remote-option',
      ],
    },
  };
  /** The words a simple command would create or write, with a name for what writes them. */
  static targetsOf(opts: { command: ISimpleCommand; base: string; tmp: string }): IWriteTarget[] {
    const program = ShellParser.programOf({ command: opts.command });
    const name = ShellParser.basenameOf({ word: program.name });
    const { args } = program;
    const { base } = opts;
    const targets: IWriteTarget[] = opts.command.redirects.map((word) => ({
      word,
      base,
      message: `a shell redirect writes ${word}`,
    }));
    const assignments = [
      ...opts.command.assignments,
      ...(['export', 'declare', 'typeset', 'local', 'readonly'].includes(name) ? args : []),
    ];

    for (const assignment of assignments.filter((word) => word.startsWith('TMPDIR='))) {
      targets.push({
        word: assignment.slice('TMPDIR='.length),
        base,
        message: 'TMPDIR points outside the project',
      });
    }

    const values = ShellWrites.VALUES[name];
    const last = positional({ args, values }).at(-1);
    const add = (word: string, message: string): number => targets.push({ word, base, message });

    if (['mkdir', 'touch'].includes(name)) {
      for (const word of positional({ args })) {
        add(word, `${name} creates ${word}`);
      }
    } else if (['cp', 'mv', 'install', 'ln', 'rsync'].includes(name)) {
      // `-t` names the destination of `cp`, `mv`, `install` and `ln`; in `rsync` it is `--times`.
      const directory =
        name === 'rsync'
          ? undefined
          : valueOf({ args, long: ['--target-directory'], short: ['t'], valued: values?.shorts });

      if (directory !== undefined) {
        add(directory, `${name} writes into ${directory}`);
      } else if (last !== undefined) {
        add(last, `${name} writes ${last}`);
      }
    } else if (name === 'tee') {
      for (const word of positional({ args })) {
        add(word, `tee writes ${word}`);
      }
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
    }

    return targets;
  }
}
