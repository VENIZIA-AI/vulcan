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

const positional = (opts: { args: string[] }): string[] =>
  opts.args.filter((word) => !word.startsWith('-'));

/** The value of a flag, long (`--output X`, `--output=X`) or short, alone or last in a cluster (`-sLo X`). */
const valueOf = (opts: {
  args: string[];
  long?: string[];
  short?: string[];
}): string | undefined => {
  for (const [index, word] of opts.args.entries()) {
    for (const flag of opts.long ?? []) {
      if (word === flag) {
        return opts.args[index + 1];
      }

      if (word.startsWith(`${flag}=`)) {
        return word.slice(flag.length + 1);
      }
    }

    for (const letter of opts.short ?? []) {
      if (new RegExp(`^-[a-zA-Z]*${letter}$`).test(word)) {
        return opts.args[index + 1];
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

    const last = positional({ args }).at(-1);
    const add = (word: string, message: string): number => targets.push({ word, base, message });

    if (['mkdir', 'touch'].includes(name)) {
      for (const word of positional({ args })) {
        add(word, `${name} creates ${word}`);
      }
    } else if (['cp', 'mv', 'install', 'ln', 'rsync'].includes(name)) {
      const directory = valueOf({ args, long: ['--target-directory'], short: ['t'] });

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
      const output = valueOf({ args, long: ['--output'], short: ['o'] });
      const directory = valueOf({ args, long: ['--output-dir'] });

      if (output !== undefined) {
        add(output, `curl saves to ${output}`);
      }

      if (directory !== undefined) {
        add(directory, `curl saves into ${directory}`);
      }
    } else if (name === 'wget') {
      const output = valueOf({ args, long: ['--output-document'], short: ['O'] });
      const directory = valueOf({ args, long: ['--directory-prefix'], short: ['P'] });

      for (const word of [output, directory]) {
        if (word !== undefined) {
          add(word, `wget saves to ${word}`);
        }
      }
    } else if (name === 'mktemp') {
      const directory = valueOf({ args, long: ['--tmpdir'], short: ['p'] });
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
