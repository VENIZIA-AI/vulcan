import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { InlineScript } from './manifest-script.ts';
import { ManifestPath, PathPattern } from './manifest-path.ts';
import type { ISimpleCommand } from './shell.ts';

interface IPathspec {
  text: string;
  isRooted: boolean;
  isExclude: boolean;
}

interface ICover {
  manifests: string[];
  isExplicit: boolean;
}

interface IQueryResult {
  /** The budget of `git` runs for this call was used up: what was asked is not known. */
  isRefused: boolean;
  status: number | null;
  stdout: string;
}

/** The `git` runs the guard makes for one tool call: few, cached, and bounded in time. */
export class GitQuery {
  static readonly MAX_SPAWNS = 8;
  static readonly TOTAL_MS = 1500;
  static readonly SPAWN_MS = 4000;
  private static spawns = 0;
  private static spentMs = 0;
  private static readonly cache = new Map<string, IQueryResult>();

  /** Starts the budget over for a new tool call. */
  static begin(): void {
    GitQuery.spawns = 0;
    GitQuery.spentMs = 0;
    GitQuery.cache.clear();
  }

  static run(opts: { args: string[]; dir: string }): IQueryResult {
    const key = `${opts.dir}\0${opts.args.join('\0')}`;
    const known = GitQuery.cache.get(key);

    if (known !== undefined) {
      return known;
    }

    if (GitQuery.spawns >= GitQuery.MAX_SPAWNS || GitQuery.spentMs >= GitQuery.TOTAL_MS) {
      return { isRefused: true, status: null, stdout: '' };
    }

    const started = performance.now();
    const result = spawnSync(
      'git',
      ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...opts.args],
      {
        cwd: opts.dir,
        encoding: 'utf8',
        timeout: Math.max(
          1,
          Math.floor(Math.min(GitQuery.SPAWN_MS, GitQuery.TOTAL_MS - GitQuery.spentMs)),
        ),
        maxBuffer: 1_048_576,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
    );
    const answer: IQueryResult = {
      isRefused: false,
      status: result.error === undefined ? result.status : null,
      stdout: result.stdout ?? '',
    };

    GitQuery.spentMs += performance.now() - started;
    GitQuery.spawns += 1;
    GitQuery.cache.set(key, answer);

    return answer;
  }

  /** Whether the file differs from the same file at `rev` (or from the index with no `rev`); an answer that never came counts as a difference. */
  static differs(opts: { rev: string | undefined; file: string; dir: string }): boolean {
    if (opts.rev?.startsWith('-')) {
      return true;
    }

    const result = GitQuery.run({
      args: ['diff', '--quiet', ...(opts.rev === undefined ? [] : [opts.rev]), '--', opts.file],
      dir: opts.dir,
    });

    return result.isRefused || result.status !== 0;
  }
}

/** A patch is read to see whether it names the manifest; what cannot be read in full is refused. */
export class PatchInput {
  static readonly MAX_BYTES = 1_048_576;
  static readonly NAME_LETTERS = 'vulcanmanifestjson';
  static readonly PROCESS_SUBSTITUTION = /<\(/;
  static readonly REDIRECTED_FILE = /(?<!<)<(?![<(])\s*([^\s;|&<>()]+)/g;
  /** The lines of a patch that name a file; its body names none. */
  static readonly HEADERS = [
    'diff --git ',
    'diff --cc ',
    'diff -',
    '--- ',
    '+++ ',
    '*** ',
    'index: ',
    'rename from ',
    'rename to ',
    'copy from ',
    'copy to ',
    'binary files ',
    'new file',
    'deleted file',
  ];

  /** Whether the file headers of the text, with git's octal escapes (`\056` for a dot) spelled out, name the manifest. */
  static namesIn(opts: { text: string }): boolean {
    for (const line of opts.text.split('\n')) {
      const lower = line.toLowerCase();

      if (PatchInput.HEADERS.some((header) => lower.startsWith(header))) {
        const decoded = line.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        );

        if (InlineScript.toLetters({ text: decoded }).includes(PatchInput.NAME_LETTERS)) {
          return true;
        }
      }
    }

    return false;
  }

  /** Whether the file cannot be read as a plain file within the size limit, or names the manifest. */
  private static refusesFile(opts: { file: string; dir: string }): boolean {
    if (opts.file === '-' || /^\/(?:dev|proc)\//.test(opts.file)) {
      return true;
    }

    const path = resolve(opts.dir, opts.file);

    try {
      // `stat` does not open the file, so a named pipe is told apart without waiting on it.
      const stats = statSync(path);

      return (
        !stats.isFile() ||
        stats.size > PatchInput.MAX_BYTES ||
        PatchInput.namesIn({ text: readFileSync(path, 'utf8') })
      );
    } catch (error) {
      console.error(
        `[PatchInput.refusesFile] cannot read ${path} | ${ManifestPath.codeOf({ error })}`,
      );

      return true;
    }
  }

  /**
   * Whether the patch a command applies is refused: it comes from somewhere that cannot be read (a pipe, the
   * standard input, a process substitution, a file that is missing, large or not a plain file), or its file
   * headers name the manifest. `files` are the patch files the command names; a `<` redirect adds its file.
   */
  static refuses(opts: {
    files: string[];
    heredoc: string | undefined;
    line: string;
    dir: string;
  }): boolean {
    if (PatchInput.PROCESS_SUBSTITUTION.test(opts.line)) {
      return true;
    }

    const redirected = Array.from(
      opts.line.matchAll(PatchInput.REDIRECTED_FILE),
      (match) => match[1] ?? '',
    );
    const files = [...opts.files, ...redirected];

    if (opts.heredoc !== undefined && PatchInput.namesIn({ text: opts.heredoc })) {
      return true;
    }

    if (files.length === 0) {
      return opts.heredoc === undefined;
    }

    return files.some((file) => PatchInput.refusesFile({ file, dir: opts.dir }));
  }
}

/** The `git` forms that bring a file back from a revision, a patch or a stash. */
export class GitRewrite {
  static readonly SUBCOMMANDS = new Set([
    'checkout',
    'restore',
    'apply',
    'am',
    'stash',
    'read-tree',
    'checkout-index',
  ]);
  /** Subcommands that take paths and only read or stage them. */
  static readonly READS_PATHS = new Set([
    'diff',
    'show',
    'log',
    'blame',
    'status',
    'ls-files',
    'cat-file',
    'rev-parse',
    'add',
    'commit',
    'check-ignore',
    'grep',
    'ls-tree',
    'diff-index',
    'diff-files',
    'diff-tree',
    'check-attr',
    'shortlog',
    'describe',
    'reflog',
    'annotate',
  ]);
  static readonly OPTIONS_WITH_VALUE = new Set([
    '-C',
    '-c',
    '--git-dir',
    '--work-tree',
    '--namespace',
    '--exec-path',
  ]);
  static readonly STASH_ACTIONS = new Set(['pop', 'apply', 'branch']);
  static readonly STASH_READS = new Set(['show', 'list']);
  /** Options of `git apply` that only look at a patch. */
  static readonly DRY_RUN = new Set(['--check', '--stat', '--numstat', '--summary']);
  static readonly MAX_SPECS = 200;
  static readonly EXPLICIT_PART = /agents|vulcan|manifest/;
  /** Verbs an alias may name: the commands that put files back. */
  static readonly ALIAS_VERBS = [
    'checkout',
    'restore',
    'apply',
    'am',
    'stash',
    'read-tree',
    'checkout-index',
    'reset',
    'merge',
    'switch',
    'cherry-pick',
    'rebase',
  ];

  /** The subcommand of a `git` line (past `-C <dir>`, `-c k=v` and the like) and where it is. */
  static subOf(opts: { args: string[] }): { sub: string; at: number } {
    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      if (GitRewrite.OPTIONS_WITH_VALUE.has(word)) {
        index += 1;
      } else if (!word.startsWith('-')) {
        return { sub: word, at: index };
      }
    }

    return { sub: '', at: -1 };
  }

  /** The pathspec without its magic (`:/`, `:(top)`, `:!`), and what the magic said. */
  private static parseSpec(opts: { word: string }): IPathspec {
    const { word } = opts;

    if (!word.startsWith(':')) {
      return { text: word, isRooted: false, isExclude: false };
    }

    if (word[1] === '(') {
      const close = word.indexOf(')');
      const magic = word
        .slice(2, close === -1 ? word.length : close)
        .toLowerCase()
        .split(',');

      return {
        text: close === -1 ? '' : word.slice(close + 1),
        isRooted: magic.includes('top'),
        isExclude: magic.includes('exclude'),
      };
    }

    const short = /^:([/!^]*):?/.exec(word);
    const marks = short?.[1] ?? '';

    return {
      text: word.slice(short?.[0].length ?? 1),
      isRooted: marks.includes('/'),
      isExclude: marks.includes('!') || marks.includes('^'),
    };
  }

  /** The manifests a pathspec read in `dir` covers; it is explicit when it names the file or the `.agents` folder. */
  private static coverOf(opts: { word: string; dir: string }): ICover {
    const spec = GitRewrite.parseSpec({ word: opts.word });
    const isWild = PathPattern.isWild({ word: spec.text });
    const tops = spec.isRooted ? ManifestPath.topsOf({ dir: opts.dir }) : undefined;
    const manifests: string[] = [];
    let isExplicit = false;

    for (const manifest of ManifestPath.candidatesOf({ dir: opts.dir })) {
      const top = tops?.find((folder) => manifest === join(folder, ManifestPath.SUFFIX));

      if (tops !== undefined && top === undefined) {
        continue;
      }

      const base = top ?? opts.dir;
      const folder = dirname(manifest);
      const target = normalize(isAbsolute(spec.text) ? spec.text : join(base, spec.text));
      const lowerTarget = target.toLowerCase().replace(/\/$/, '');
      const isCovered = isWild
        ? PathPattern.matchesAny({ pattern: target, texts: [manifest, folder], crossesSlash: true })
        : manifest.toLowerCase() === lowerTarget ||
          manifest.toLowerCase().startsWith(`${lowerTarget}/`);

      if (isCovered) {
        manifests.push(manifest);
        isExplicit =
          isExplicit ||
          (isWild
            ? GitRewrite.EXPLICIT_PART.test(spec.text.toLowerCase())
            : [manifest, folder].some((path) => path.toLowerCase() === lowerTarget));
      }
    }

    return { manifests, isExplicit };
  }

  /** The revision a `checkout` takes files from and the pathspecs it names. */
  private static checkoutParts(opts: { words: string[] }): {
    rev: string | undefined;
    specs: string[];
    isIndexOnly: boolean;
  } {
    const dash = opts.words.indexOf('--');
    const before = (dash === -1 ? opts.words : opts.words.slice(0, dash)).filter(
      (word) => !word.startsWith('-'),
    );
    const after = dash === -1 ? [] : opts.words.slice(dash + 1);

    if (opts.words.some((word) => word.startsWith('--pathspec-from-file'))) {
      return { rev: before[0], specs: [...after, '.'], isIndexOnly: false };
    }

    if (dash !== -1) {
      return { rev: before[0], specs: after, isIndexOnly: false };
    }

    return before.length >= 2
      ? { rev: before[0], specs: before.slice(1), isIndexOnly: false }
      : { rev: undefined, specs: before, isIndexOnly: false };
  }

  /** The source of a `restore` (`-s`, `-sREV`, `--source`) and its pathspecs. */
  private static restoreParts(opts: { words: string[] }): {
    rev: string | undefined;
    specs: string[];
    isIndexOnly: boolean;
  } {
    let rev: string | undefined;
    const specs: string[] = [];
    const letters: string[] = [];
    let isAfterDash = false;

    for (let index = 0; index < opts.words.length; index += 1) {
      const word = opts.words[index] ?? '';
      const short = /^-([A-Za-z]*)s(.*)$/.exec(word);

      if (isAfterDash) {
        specs.push(word);
      } else if (word === '--') {
        isAfterDash = true;
      } else if (word === '--source') {
        rev = opts.words[index + 1];
        index += 1;
      } else if (word.startsWith('--source=')) {
        rev = word.slice('--source='.length);
      } else if (word.startsWith('--pathspec-from-file')) {
        specs.push('.');
      } else if (word === '--staged' || word === '--worktree') {
        letters.push(word === '--staged' ? 'S' : 'W');
      } else if (short !== null && !word.startsWith('--')) {
        letters.push(...(short[1] ?? '').split(''));

        if ((short[2] ?? '') === '') {
          rev = opts.words[index + 1];
          index += 1;
        } else {
          rev = short[2];
        }
      } else if (/^-[A-Za-z]+$/.test(word)) {
        letters.push(...word.slice(1).split(''));
      } else if (!word.startsWith('-')) {
        specs.push(word);
      }
    }

    return { rev, specs, isIndexOnly: letters.includes('S') && !letters.includes('W') };
  }

  private static rewritesFiles(opts: { sub: string; words: string[]; dir: string }): boolean {
    const { rev, specs, isIndexOnly } =
      opts.sub === 'checkout'
        ? GitRewrite.checkoutParts({ words: opts.words })
        : GitRewrite.restoreParts({ words: opts.words });

    if (isIndexOnly) {
      return false;
    }

    // Too many pathspecs to read one by one stand for the whole tree.
    const listed = [...new Set(specs)];
    const all = listed.length > GitRewrite.MAX_SPECS ? ['.'] : listed;
    const isExclude = (word: string): boolean => GitRewrite.parseSpec({ word }).isExclude;
    const excludes = all.filter(isExclude);
    // Only exclusions name everything but what they exclude.
    const positives = all.filter((word) => !isExclude(word));
    const included = (positives.length === 0 && excludes.length > 0 ? ['.'] : positives).map(
      (word) => GitRewrite.coverOf({ word, dir: opts.dir }),
    );
    const excluded = excludes.flatMap(
      (word) =>
        GitRewrite.coverOf({
          word: word.replace(/^:(?:\([^)]*\)|[!^])/, ':'),
          dir: opts.dir,
        }).manifests,
    );
    const manifests = [...new Set(included.flatMap((cover) => cover.manifests))].filter(
      (manifest) => !excluded.includes(manifest),
    );

    if (manifests.length === 0) {
      return false;
    }

    if (rev === undefined) {
      // From the index: a whole-tree restore is a different command; a pathspec that names the file is
      // refused unless the file is the one in the index.
      return (
        included.some((cover) => cover.isExplicit) &&
        manifests.some((manifest) =>
          GitQuery.differs({ rev: undefined, file: manifest, dir: opts.dir }),
        )
      );
    }

    return manifests.some((manifest) => GitQuery.differs({ rev, file: manifest, dir: opts.dir }));
  }

  /** Whether the stash lists the manifest. `git` is asked, within the budget; an answer that never came is not let through. */
  private static stashHolds(opts: { dir: string; stash: string | undefined }): boolean {
    const ref = opts.stash === undefined ? [] : [opts.stash];
    let result = GitQuery.run({
      args: ['stash', 'show', '--name-only', '--include-untracked', ...ref],
      dir: opts.dir,
    });

    // `--include-untracked` is newer than `stash show`; without it an untracked file in the stash is not listed.
    if (!result.isRefused && result.status !== 0) {
      result = GitQuery.run({ args: ['stash', 'show', '--name-only', ...ref], dir: opts.dir });
    }

    if (result.isRefused) {
      return true;
    }

    return (
      result.status === 0 &&
      result.stdout
        .split('\n')
        .some((line) => `/${line.trim()}`.toLowerCase().endsWith(ManifestPath.SUFFIX))
    );
  }

  /** The folder git runs in: `-C <dir>` and `--work-tree <dir>` before the subcommand move it. */
  private static folderOf(opts: { args: string[]; at: number; dir: string }): string {
    let dir = opts.dir;

    for (let index = 0; index < opts.at; index += 1) {
      const word = opts.args[index] ?? '';
      const next = opts.args[index + 1];

      if ((word === '-C' || word === '--work-tree') && next !== undefined) {
        dir = resolve(dir, next);
        index += 1;
      } else if (word.startsWith('--work-tree=')) {
        dir = resolve(dir, word.slice('--work-tree='.length));
      }
    }

    return dir;
  }

  /** Whether an alias is set (`-c alias.x=..`, `git config alias.x ..`) whose text names a command that puts files back, or any alias on a line about `.agents`. */
  private static setsAlias(opts: { args: string[]; isAbout: boolean }): boolean {
    return opts.args.some((word, index) => {
      if (!word.toLowerCase().startsWith('alias.')) {
        return false;
      }

      const value =
        `${word.slice(word.indexOf('=') + 1)} ${opts.args[index + 1] ?? ''}`.toLowerCase();

      return (
        opts.isAbout ||
        value.split(/[^a-z-]+/).some((part) => GitRewrite.ALIAS_VERBS.includes(part))
      );
    });
  }

  /** Whether this simple command is a `git` form that rewrites the manifest from a revision, a patch or a stash. */
  static rewrites(opts: {
    command: ISimpleCommand;
    args: string[];
    line: string;
    dir: string;
    isAbout: boolean;
  }): boolean {
    const { args } = opts;

    if (GitRewrite.setsAlias({ args, isAbout: opts.isAbout })) {
      return true;
    }

    const { sub, at } = GitRewrite.subOf({ args });

    if (!GitRewrite.SUBCOMMANDS.has(sub)) {
      return false;
    }

    const words = args.slice(at + 1);
    const dir = GitRewrite.folderOf({ args, at, dir: opts.dir });

    switch (sub) {
      case 'checkout':
      case 'restore': {
        return GitRewrite.rewritesFiles({ sub, words, dir });
      }
      case 'apply':
      case 'am': {
        const isDryRun =
          words.some((word) => GitRewrite.DRY_RUN.has(word)) && !words.includes('--apply');

        return (
          !isDryRun &&
          (words.some((word) => PatchInput.namesIn({ text: word })) ||
            PatchInput.refuses({
              files: words.filter((word) => !word.startsWith('-') || word === '-'),
              heredoc: opts.command.heredoc,
              line: opts.line,
              dir,
            }))
        );
      }
      case 'read-tree': {
        return words.some((word) => /^-[A-Za-z]*u/.test(word));
      }
      case 'checkout-index': {
        return words.some((word) => word === '--all' || /^-[A-Za-z]*a/.test(word));
      }
      default: {
        const action = words.find((word) => !word.startsWith('-'));
        const stash = words.find((word) => /^(?:stash@\{\d+\}|\d+)$/.test(word));

        return (
          action !== undefined &&
          GitRewrite.STASH_ACTIONS.has(action) &&
          GitRewrite.stashHolds({
            dir,
            stash: stash !== undefined && /^\d+$/.test(stash) ? `stash@{${stash}}` : stash,
          })
        );
      }
    }
  }
}
