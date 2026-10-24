import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { basenameOf, parseShell, programOf } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { HookConstants } from './common/index.ts';
import type { IManifestHookInput, IOutsideHit } from './common/index.ts';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

type TEnvironment = Record<string, string | undefined>;

/** `~` and `$NAME` / `${NAME}` expanded; `undefined` when a variable is unset or the word is not a plain path. */
const expandPath = (opts: {
  word: string;
  home: string;
  env: TEnvironment;
}): string | undefined => {
  if (opts.word === '' || /[`*?[]/.test(opts.word) || opts.word.includes('$(')) {
    return undefined;
  }

  let unresolved = false;
  const home = opts.word === '~' || opts.word.startsWith('~/') ? opts.home : undefined;
  const withHome = home === undefined ? opts.word : `${home}${opts.word.slice(1)}`;
  const expanded = withHome.replace(/\$\{?(\w+)\}?/g, (_, name: string) => {
    const value = opts.env[name];

    if (value === undefined || value === '') {
      unresolved = true;
    }

    return value ?? '';
  });

  return unresolved ? undefined : expanded;
};

/**
 * The path with the nearest existing ancestor resolved through symlinks, so a link cannot walk out of the
 * project; a dangling link is followed to where it points.
 */
const realOf = (opts: { path: string; depth?: number }): string => {
  const depth = opts.depth ?? 0;
  let existing = opts.path;
  const rest: string[] = [];

  while (dirname(existing) !== existing) {
    try {
      lstatSync(existing);
      break;
    } catch {
      rest.unshift(existing.slice(dirname(existing).length + 1));
      existing = dirname(existing);
    }
  }

  let base: string;

  try {
    base = realpathSync(existing);
  } catch {
    // A dangling link: its target is where a write through it lands.
    const target = depth < 8 ? readlinkSync(existing) : existing;

    base = realOf({ path: resolve(dirname(existing), target), depth: depth + 1 });
  }

  return join(base, ...rest);
};

const isInside = (opts: { path: string; root: string }): boolean =>
  opts.path === opts.root || opts.path.startsWith(`${opts.root}${sep}`);

/**
 * A tool-owned pattern as an absolute glob: `~` and variables expanded, a bare directory taking everything
 * below it. A pattern with an unset variable is dropped - it would otherwise match from the root.
 */
const allowPatterns = (opts: { patterns: string[]; home: string; env: TEnvironment }): string[] =>
  opts.patterns.flatMap((pattern) => {
    if ((pattern === '~' || pattern.startsWith('~/')) && opts.home === '') {
      return [];
    }

    const withHome =
      pattern === '~' || pattern.startsWith('~/') ? `${opts.home}${pattern.slice(1)}` : pattern;
    let unresolved = false;
    const concrete = withHome.replace(/\$\{?(\w+)\}?/g, (_, name: string) => {
      const value = opts.env[name];

      if (value === undefined || value === '') {
        unresolved = true;
      }

      return value ?? '';
    });

    if (unresolved || !isAbsolute(concrete)) {
      return [];
    }

    return [concrete, /[*?[]/.test(concrete) ? concrete : `${concrete}/**`];
  });

const isAllowed = (opts: { path: string; patterns: string[] }): boolean =>
  opts.patterns.some((pattern) => new Bun.Glob(pattern).match(opts.path));

interface ITarget {
  word: string;
  message: string;
  /** The directory a relative `word` is taken from: the hook's, moved by `cd` and `git -C`. */
  base: string;
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

const gitTargets = (opts: { rest: string[]; base: string; dir: string | undefined }): ITarget[] => {
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

/** The words a simple command would create or write, with a name for what writes them. */
const targetsOf = (opts: { command: ISimpleCommand; base: string }): ITarget[] => {
  const program = programOf({ command: opts.command });
  const name = basenameOf({ word: program.name });
  const { args } = program;
  const { base } = opts;
  const targets: ITarget[] = opts.command.redirects.map((word) => ({
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
      add(tmpdir(), 'mktemp creates a file in the system temp directory');
    } else {
      add(template, 'mktemp creates a temporary file');
    }
  } else if (name === 'git') {
    const { rest, dir } = gitArguments({ args });

    targets.push(...gitTargets({ rest, base, dir }));
  }

  return targets;
};

/**
 * Every file, worktree, clone or temp file `input` would create outside the project. Files a package
 * manager, a runtime or the agent tool manage themselves are allowed (`toolOwnedPaths`, extending the
 * defaults); pointing `TMPDIR` or `mktemp` at the system temp directory is not. It reads common
 * forms - redirects, mkdir, cp, mv, tee, curl -o, git clone, git worktree add, mktemp, `cd` - and is a
 * guard against drift, not a sandbox: a path it cannot work out (an unset variable, a glob) passes.
 */
export const inspectOutside = (opts: {
  input: IManifestHookInput;
  projectRoot: string;
  toolOwnedPaths?: string[];
  home?: string;
  env?: TEnvironment;
}): IOutsideHit[] => {
  const env = opts.env ?? process.env;
  const home = opts.home ?? env.HOME ?? '';
  const root = realOf({ path: resolve(opts.projectRoot) });
  const patterns = allowPatterns({
    patterns: [...HookConstants.TOOL_OWNED_PATHS, ...(opts.toolOwnedPaths ?? [])],
    home,
    env,
  });
  const start = opts.input.cwd ?? opts.projectRoot;
  const targets: ITarget[] = [];

  if (FILE_TOOLS.has(opts.input.tool) && opts.input.filePath !== undefined) {
    targets.push({
      word: opts.input.filePath,
      base: start,
      message: `${opts.input.tool} writes ${opts.input.filePath}`,
    });
  }

  if (opts.input.command !== undefined) {
    let base = start;

    for (const command of parseShell({ command: opts.input.command })) {
      const program = programOf({ command });

      if (basenameOf({ word: program.name }) === 'cd') {
        const [destination] = positional({ args: program.args });
        const expanded =
          destination === undefined ? undefined : expandPath({ word: destination, home, env });

        base = expanded === undefined ? base : resolve(base, expanded);
        continue;
      }

      targets.push(...targetsOf({ command, base }));
    }
  }

  const hits: IOutsideHit[] = [];

  for (const target of targets) {
    const expanded = expandPath({ word: target.word, home, env });

    if (expanded === undefined) {
      continue;
    }

    const path = realOf({ path: resolve(target.base, expanded) });

    if (!isInside({ path, root }) && !isAllowed({ path, patterns })) {
      hits.push({ path, message: target.message });
    }
  }

  return hits;
};
