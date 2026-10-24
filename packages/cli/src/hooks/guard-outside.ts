import { existsSync, realpathSync } from 'node:fs';
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

/** The path with the nearest existing ancestor resolved through symlinks, so a link cannot walk out of the project. */
const realOf = (opts: { path: string }): string => {
  let existing = opts.path;
  const rest: string[] = [];

  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(existing.slice(dirname(existing).length + 1));
    existing = dirname(existing);
  }

  return join(realpathSync(existing), ...rest);
};

const isInside = (opts: { path: string; root: string }): boolean =>
  opts.path === opts.root || opts.path.startsWith(`${opts.root}${sep}`);

/**
 * A tool-owned pattern as an absolute glob: `~` and variables expanded, a bare directory taking everything
 * below it. A pattern with an unset variable is dropped - it would otherwise match from the root.
 */
const allowPatterns = (opts: { patterns: string[]; home: string; env: TEnvironment }): string[] =>
  opts.patterns.flatMap((pattern) => {
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
}

const positional = (opts: { args: string[] }): string[] =>
  opts.args.filter((word) => !word.startsWith('-'));

const valueOf = (opts: { args: string[]; flags: string[] }): string | undefined => {
  for (const [index, word] of opts.args.entries()) {
    for (const flag of opts.flags) {
      if (word === flag) {
        return opts.args[index + 1];
      }

      if (flag.startsWith('--') && word.startsWith(`${flag}=`)) {
        return word.slice(flag.length + 1);
      }
    }
  }

  return undefined;
};

/** The words a simple command would create or write, with a name for what writes them. */
const targetsOf = (opts: { command: ISimpleCommand }): ITarget[] => {
  const program = programOf({ command: opts.command });
  const name = basenameOf({ word: program.name });
  const { args } = program;
  const targets: ITarget[] = opts.command.redirects.map((word) => ({
    word,
    message: `a shell redirect writes ${word}`,
  }));

  for (const assignment of opts.command.assignments) {
    if (assignment.startsWith('TMPDIR=')) {
      targets.push({
        word: assignment.slice('TMPDIR='.length),
        message: 'TMPDIR points outside the project',
      });
    }
  }

  const last = positional({ args }).at(-1);

  if (['mkdir', 'touch'].includes(name)) {
    targets.push(
      ...positional({ args }).map((word) => ({ word, message: `${name} creates ${word}` })),
    );
  } else if (['cp', 'mv', 'install', 'ln', 'rsync'].includes(name) && last !== undefined) {
    targets.push({ word: last, message: `${name} writes ${last}` });
  } else if (name === 'tee') {
    targets.push(...positional({ args }).map((word) => ({ word, message: `tee writes ${word}` })));
  } else if (name === 'dd') {
    const output = args.find((word) => word.startsWith('of='));

    if (output !== undefined) {
      targets.push({ word: output.slice(3), message: `dd writes ${output.slice(3)}` });
    }
  } else if (name === 'curl') {
    const output = valueOf({ args, flags: ['-o', '--output'] });

    if (output !== undefined) {
      targets.push({ word: output, message: `curl saves to ${output}` });
    }
  } else if (name === 'wget') {
    const output = valueOf({ args, flags: ['-O', '--output-document'] });
    const directory = valueOf({ args, flags: ['-P', '--directory-prefix'] });

    for (const word of [output, directory]) {
      if (word !== undefined) {
        targets.push({ word, message: `wget saves to ${word}` });
      }
    }
  } else if (name === 'mktemp') {
    const directory = valueOf({ args, flags: ['-p', '--tmpdir'] });
    const [template] = positional({ args }).filter((word) => word !== directory);

    targets.push({
      word: directory ?? template ?? tmpdir(),
      message:
        directory === undefined && template === undefined
          ? 'mktemp creates a file in the system temp directory'
          : 'mktemp creates a temporary file',
    });
  } else if (name === 'git') {
    const sub = positional({ args })[0];

    if (sub === 'worktree' && positional({ args })[1] === 'add') {
      const afterAdd = args.slice(args.indexOf('add') + 1);
      const skipped = new Set<number>();

      for (const [index, word] of afterAdd.entries()) {
        if (word === '-b' || word === '-B') {
          skipped.add(index);
          skipped.add(index + 1);
        }
      }

      const path = afterAdd.find((word, index) => !word.startsWith('-') && !skipped.has(index));

      if (path !== undefined) {
        targets.push({ word: path, message: `git worktree add creates ${path}` });
      }
    } else if (sub === 'clone') {
      const [, url, destination] = positional({ args });

      if (destination !== undefined) {
        targets.push({ word: destination, message: `git clone writes ${destination}` });
      } else if (url !== undefined) {
        targets.push({ word: '.', message: 'git clone writes into the current directory' });
      }
    }
  }

  return targets;
};

/**
 * Every file, worktree, clone or temp file `input` would create outside the project. Files a package
 * manager, a runtime or the agent tool manage themselves are allowed (`toolOwnedPaths`, extending the
 * defaults); pointing `TMPDIR` or `mktemp` at the system temp directory is not. It reads common
 * forms - redirects, mkdir, cp, mv, tee, curl -o, git clone, git worktree add, mktemp - and is a
 * guard against drift, not a sandbox.
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
  const cwd = opts.input.cwd ?? opts.projectRoot;
  const root = realOf({ path: resolve(opts.projectRoot) });
  const patterns = allowPatterns({
    patterns: [...HookConstants.TOOL_OWNED_PATHS, ...(opts.toolOwnedPaths ?? [])],
    home,
    env,
  });
  const words: ITarget[] = [];

  if (FILE_TOOLS.has(opts.input.tool) && opts.input.filePath !== undefined) {
    words.push({
      word: opts.input.filePath,
      message: `${opts.input.tool} writes ${opts.input.filePath}`,
    });
  }

  if (opts.input.command !== undefined) {
    for (const command of parseShell({ command: opts.input.command })) {
      words.push(...targetsOf({ command }));
    }
  }

  const hits: IOutsideHit[] = [];

  for (const target of words) {
    const expanded = expandPath({ word: target.word, home, env });

    if (expanded === undefined) {
      continue;
    }

    const path = realOf({
      path: isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded),
    });

    if (!isInside({ path, root }) && !isAllowed({ path, patterns })) {
      hits.push({ path, message: target.message });
    }
  }

  return hits;
};
