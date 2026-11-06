import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { HookConstants } from './common/index.ts';
import { InlineScript } from './manifest-script.ts';
import { ManifestPath, PathPattern } from './manifest-path.ts';
import { ShellParser } from './shell.ts';
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

/** A patch is read to see whether it names the manifest; what cannot be read in full is refused. */
export class PatchInput {
  static readonly MAX_BYTES = 1_048_576;
  static readonly NAME_LETTERS = 'vulcanmanifestjson';
  static readonly PROCESS_SUBSTITUTION = /<\(/;
  static readonly REDIRECTED_FILE = /(?<!<)<(?![<(])\s*([^\s;|&<>()]+)/g;

  /** Whether the text, with git's octal escapes (`\056` for a dot) spelled out, names the manifest. */
  static namesIn(opts: { text: string }): boolean {
    const decoded = opts.text.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );

    return InlineScript.toLetters({ text: decoded }).includes(PatchInput.NAME_LETTERS);
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
   * standard input, a process substitution, a file that is missing, large or not a plain file), or it names
   * the manifest. `files` are the patch files the command names; a `<` redirect adds its file.
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
  static readonly SUBCOMMANDS = new Set(['checkout', 'restore', 'apply', 'am', 'stash']);
  static readonly STASH_ACTIONS = new Set(['pop', 'apply', 'branch']);
  /** Options of `git apply` that only look at a patch. */
  static readonly DRY_RUN = new Set(['--check', '--stat', '--numstat', '--summary']);
  static readonly EXPLICIT_PART = /agents|vulcan|manifest/;

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

    const short = /^:([/!^]*):?/.exec(word)?.[1] ?? '';

    return {
      text: word.slice(/^:[/!^]*:?/.exec(word)?.[0].length ?? 1),
      isRooted: short.includes('/'),
      isExclude: short.includes('!') || short.includes('^'),
    };
  }

  /** The manifests a pathspec read in `dir` covers; it is explicit when it names the file or the `.agents` folder. */
  private static coverOf(opts: { word: string; dir: string }): ICover {
    const spec = GitRewrite.parseSpec({ word: opts.word });

    if (spec.isExclude) {
      return { manifests: [], isExplicit: false };
    }

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
      const pattern = isWild
        ? PathPattern.toRegExp({ word: target, crossesSlash: true })
        : undefined;
      const isCovered = isWild
        ? pattern === undefined || pattern.test(manifest) || pattern.test(folder)
        : manifest.toLowerCase() === target.toLowerCase() ||
          manifest.toLowerCase().startsWith(`${target.toLowerCase().replace(/\/$/, '')}/`);

      if (isCovered) {
        manifests.push(manifest);
        isExplicit =
          isExplicit ||
          (isWild
            ? GitRewrite.EXPLICIT_PART.test(spec.text.toLowerCase())
            : [manifest, folder].some((path) => path.toLowerCase() === target.toLowerCase()));
      }
    }

    return { manifests, isExplicit };
  }

  /** Whether the working file differs from the one at `rev`, or cannot be compared (an error, a timeout). */
  private static differsFrom(opts: { rev: string; manifest: string; dir: string }): boolean {
    if (opts.rev.startsWith('-')) {
      return true;
    }

    const result = spawnSync('git', ['diff', '--quiet', opts.rev, '--', opts.manifest], {
      cwd: opts.dir,
      timeout: HookConstants.QUERY_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    return result.error !== undefined || result.status !== 0;
  }

  /** The revision a `checkout` takes files from and the pathspecs it names. */
  private static checkoutParts(opts: { words: string[] }): {
    rev: string | undefined;
    specs: string[];
  } {
    const dash = opts.words.indexOf('--');
    const before = (dash === -1 ? opts.words : opts.words.slice(0, dash)).filter(
      (word) => !word.startsWith('-'),
    );

    if (dash !== -1) {
      return { rev: before[0], specs: opts.words.slice(dash + 1) };
    }

    return before.length >= 2
      ? { rev: before[0], specs: before.slice(1) }
      : { rev: undefined, specs: before };
  }

  /** The source of a `restore` (`-s`, `--source`) and its pathspecs. */
  private static restoreParts(opts: { words: string[] }): {
    rev: string | undefined;
    specs: string[];
    isIndexOnly: boolean;
  } {
    let rev: string | undefined;
    const specs: string[] = [];
    let isAfterDash = false;

    for (let index = 0; index < opts.words.length; index += 1) {
      const word = opts.words[index] ?? '';

      if (isAfterDash) {
        specs.push(word);
      } else if (word === '--') {
        isAfterDash = true;
      } else if (word === '-s' || word === '--source') {
        rev = opts.words[index + 1];
        index += 1;
      } else if (word.startsWith('--source=')) {
        rev = word.slice('--source='.length);
      } else if (word.startsWith('--pathspec-from-file')) {
        specs.push('/');
      } else if (!word.startsWith('-')) {
        specs.push(word);
      }
    }

    const has = (long: string, short: string): boolean =>
      opts.words.some((word) => word === long || new RegExp(`^-[A-Za-z]*${short}`).test(word));

    return { rev, specs, isIndexOnly: has('--staged', 'S') && !has('--worktree', 'W') };
  }

  private static rewritesFiles(opts: { sub: string; words: string[]; dir: string }): boolean {
    const { rev, specs, isIndexOnly } =
      opts.sub === 'checkout'
        ? { ...GitRewrite.checkoutParts({ words: opts.words }), isIndexOnly: false }
        : GitRewrite.restoreParts({ words: opts.words });

    if (isIndexOnly) {
      return false;
    }

    const covers = specs.map((word) => GitRewrite.coverOf({ word, dir: opts.dir }));
    const manifests = [...new Set(covers.flatMap((cover) => cover.manifests))];

    if (manifests.length === 0) {
      return false;
    }

    if (rev === undefined) {
      // From the index: a whole-tree restore is a different command; a pathspec that names the file is not.
      return covers.some((cover) => cover.isExplicit);
    }

    return manifests.some((manifest) => GitRewrite.differsFrom({ rev, manifest, dir: opts.dir }));
  }

  /** Whether the stash lists the manifest. `git` is asked, with a time limit; a timeout is not let through. */
  private static stashHolds(opts: { dir: string; stash: string | undefined }): boolean {
    const ref = opts.stash === undefined ? [] : [opts.stash];
    const spawnOptions = {
      cwd: opts.dir,
      encoding: 'utf8' as const,
      timeout: HookConstants.QUERY_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    };
    let result = spawnSync(
      'git',
      ['stash', 'show', '--name-only', '--include-untracked', ...ref],
      spawnOptions,
    );

    // `--include-untracked` is newer than `stash show`; without it an untracked file in the stash is not listed.
    if (result.status !== 0 && result.error === undefined) {
      result = spawnSync('git', ['stash', 'show', '--name-only', ...ref], spawnOptions);
    }

    if (result.error !== undefined) {
      return ManifestPath.codeOf({ error: result.error }) === 'ETIMEDOUT';
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

  /** Whether an alias is set on the command line or in the config: its text runs a command of its own. */
  private static setsAlias(opts: { args: string[] }): boolean {
    return opts.args.some((word) => word.toLowerCase().startsWith('alias.'));
  }

  /** Whether this simple command is a `git` form that rewrites the manifest from a revision, a patch or a stash. */
  static rewrites(opts: {
    command: ISimpleCommand;
    line: string;
    dir: string;
    mentions: boolean;
  }): boolean {
    const { name, args } = ShellParser.programOf({ command: opts.command });

    if (ShellParser.basenameOf({ word: name }) !== 'git') {
      return false;
    }

    if (opts.mentions && GitRewrite.setsAlias({ args })) {
      return true;
    }

    const at = args.findIndex((word) => GitRewrite.SUBCOMMANDS.has(word));

    if (at === -1) {
      return false;
    }

    const words = args.slice(at + 1);
    const dir = GitRewrite.folderOf({ args, at, dir: opts.dir });
    const sub = args[at] ?? '';

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
