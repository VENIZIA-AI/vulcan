import { basename, resolve } from 'node:path';
import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IManifestHookInput } from './common/index.ts';
import { HookDecision } from './decision.ts';
import { GitRewrite, PatchInput } from './manifest-git.ts';
import { ManifestPath, PathPattern } from './manifest-path.ts';
import { InlineScript } from './manifest-script.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

/** The shell tool under the names the hosts give it: Cursor's `Shell`, and a lower-case `bash`. */
const SHELL_NAMES = new Set(['Shell', 'shell', 'bash']);

const MANIFEST_BLOCK_MESSAGE =
  'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`';

const BASH_TOOL = 'Bash';
/** A path word that ends in the manifest's name. */
const TARGET = String.raw`[^\s;|&<>"']*vulcan\.manifest\.json`;

/** The shell forms that write, replace or delete a file; reading it (cat, jq, git diff) is not among them. */
const WRITE_PATTERNS: RegExp[] = [
  // `> file`, `>> file`, `2> file`, `&> file`, `>| file`
  new RegExp(String.raw`(?:^|[^<>])\d?>>?\|?\s*["']?${TARGET}`),
  new RegExp(String.raw`\btee\b[^;|&]*${TARGET}`),
  new RegExp(
    String.raw`\b(?:sed|perl|ruby)\b[^;|&]*\s(?:-[A-Za-z0-9]*i|--in-place)[^;|&]*${TARGET}`,
  ),
  new RegExp(String.raw`\b[gmn]?awk\b[^;|&]*\s-i\s*inplace[^;|&]*${TARGET}`),
  new RegExp(String.raw`\b(?:ed|ex|vim?|nvim)\b[^;|&]*${TARGET}`),
  // the manifest as the destination: the last argument
  new RegExp(String.raw`\b(?:cp|mv|install|ln)\b[^;|&]*\s["']?${TARGET}["']?\s*(?:$|[;|&])`),
  new RegExp(String.raw`\bof=["']?${TARGET}`),
  new RegExp(String.raw`\b(?:rm|truncate|shred|unlink)\b[^;|&]*${TARGET}`),
];

/** What the shell programs that write, copy, move or remove files do to the paths they are given. */
class ShellWrites {
  /** Programs that change every file they are given. */
  static readonly EVERY = new Set([
    'tee',
    'rm',
    'truncate',
    'shred',
    'unlink',
    'ed',
    'ex',
    'vi',
    'vim',
    'nvim',
    'patch',
    'sponge',
  ]);
  /** Programs that write only their last file argument. */
  static readonly LAST = new Set(['cp', 'mv', 'install', 'rsync', 'ln']);
  static readonly IN_PLACE = new Set(['sed', 'perl', 'ruby', 'awk', 'gawk', 'mawk']);
  static readonly DESTRUCTIVE = new Set(['rm', 'mv', 'shred', 'truncate', 'unlink']);
  static readonly COPIERS = new Set(['cp', 'install', 'rsync']);
  static readonly FIND_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);
  /** Programs a `xargs` hands its input to that change files or run a script. */
  static readonly XARGS_WRITERS = new Set([
    'tee',
    'rm',
    'truncate',
    'shred',
    'unlink',
    'ed',
    'ex',
    'vi',
    'vim',
    'nvim',
    'patch',
    'cp',
    'mv',
    'install',
    'rsync',
    'ln',
    'sed',
    'perl',
    'ruby',
    'awk',
    'gawk',
    'mawk',
    'dd',
    'tar',
    'unzip',
    'sh',
    'bash',
    'zsh',
    'dash',
  ]);

  static programOf(opts: { command: ISimpleCommand }): { program: string; args: string[] } {
    const { name, args } = ShellParser.programOf({ command: opts.command });

    return { program: ShellParser.basenameOf({ word: name }), args };
  }

  private static isInPlace(opts: { program: string; args: string[] }): boolean {
    if (!ShellWrites.IN_PLACE.has(opts.program)) {
      return false;
    }

    return opts.args.some(
      (word) => /^-[A-Za-z0-9]*i/.test(word) || word.startsWith('--in-place') || word === 'inplace',
    );
  }

  /** The files a simple command writes, replaces or removes by its own words: its redirects and the files it is given. */
  static targetsOf(opts: { command: ISimpleCommand }): string[] {
    const { program, args } = ShellWrites.programOf(opts);
    const files = args.filter((word) => !word.startsWith('-'));
    const redirects = opts.command.redirects.filter((target) => !target.startsWith('&'));

    if (ShellWrites.EVERY.has(program) || ShellWrites.isInPlace({ program, args })) {
      return [...redirects, ...files];
    }

    if (program === 'dd') {
      return [
        ...redirects,
        ...args.filter((word) => word.startsWith('of=')).map((word) => word.slice(3)),
      ];
    }

    // Only the last argument of a copy or a move is written; the others are read.
    return ShellWrites.LAST.has(program) && files.length > 1
      ? [...redirects, files[files.length - 1] ?? '']
      : redirects;
  }

  /**
   * Whether a target with a pattern or an expansion could be the manifest. A pattern that names `.agents`, or
   * stands on a line or in a folder about it, is read that way; a program that removes files also answers
   * for a plain pattern that could be the `.agents` folder.
   */
  private static hitsPattern(opts: {
    path: string;
    dir: string;
    mentions: boolean;
    program: string;
  }): boolean {
    const { path, dir } = opts;

    if (!PathPattern.isWild({ word: path })) {
      return false;
    }

    const isAbout =
      opts.mentions ||
      basename(dir) === ManifestPath.FOLDER ||
      InlineScript.mentionsFolder({ text: path });

    if (isAbout && PathPattern.couldName({ word: path, dir, crossesSlash: false, folder: false })) {
      return true;
    }

    return (
      ShellWrites.DESTRUCTIVE.has(opts.program) &&
      !/[$`]/.test(path) &&
      PathPattern.couldName({ word: path, dir, crossesSlash: false, folder: true })
    );
  }

  /** Whether any file the command changes is the manifest, by name, through a link or as a pattern. */
  static hitsManifest(opts: { command: ISimpleCommand; dir: string; mentions: boolean }): boolean {
    const { program } = ShellWrites.programOf(opts);

    return ShellWrites.targetsOf(opts).some(
      (path) =>
        ManifestPath.isWriteTarget({ path, cwd: opts.dir }) ||
        ShellWrites.hitsPattern({ path, dir: opts.dir, mentions: opts.mentions, program }),
    );
  }

  /** Whether a copy puts the `.agents` folder, or files under the name of one of its parts, onto a folder that holds the manifest. */
  private static copiesOntoFolder(opts: {
    program: string;
    args: string[];
    files: string[];
    dir: string;
  }): boolean {
    const dest = opts.files[opts.files.length - 1] ?? '';
    const sources = opts.files.slice(0, -1);
    const isTree =
      opts.program === 'rsync' ||
      opts.args.some(
        (word) => /^-[A-Za-z]*[rRaT]/.test(word) || /^--(?:recursive|archive|no-target)/.test(word),
      );

    if (opts.files.length < 2) {
      return false;
    }

    if (ManifestPath.isFolder({ word: dest })) {
      return (
        isTree ||
        sources.some(
          (word) =>
            InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) }) ||
            PathPattern.isWild({ word }),
        )
      );
    }

    if (!isTree || !sources.some((word) => ManifestPath.isFolder({ word }))) {
      return false;
    }

    // A folder named `.agents` copied onto the folder it would be made in merges into the one there.
    const target = resolve(opts.dir, dest);

    return opts.dir === target || opts.dir.startsWith(`${target.replace(/\/$/, '')}/`);
  }

  /** Whether `find` runs an action on a path that is, or could be, the `.agents` folder or the manifest. */
  private static findsManifest(opts: { args: string[]; dir: string }): boolean {
    if (!opts.args.some((word) => ShellWrites.FIND_ACTIONS.has(word))) {
      return false;
    }

    const stop = opts.args.findIndex(
      (word) => word.startsWith('-') || word === '(' || word === '!',
    );
    const starts = stop === -1 ? opts.args : opts.args.slice(0, stop);

    return (
      starts.some(
        (word) =>
          ManifestPath.isFolder({ word }) ||
          ManifestPath.isWriteTarget({ path: word, cwd: opts.dir }) ||
          (PathPattern.isWild({ word }) &&
            PathPattern.couldName({ word, dir: opts.dir, crossesSlash: false, folder: true })),
      ) ||
      opts.args.some((word) =>
        InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) }),
      )
    );
  }

  private static isExtracting(opts: { args: string[] }): boolean {
    const [first] = opts.args;

    return (
      (first !== undefined && /^[A-Za-z]*x/.test(first) && !first.startsWith('-')) ||
      opts.args.some(
        (word) => /^-[A-Za-z]*x/.test(word) || word === '--extract' || word === '--get',
      )
    );
  }

  /** Whether a program that writes whole trees, or removes them, is aimed at the `.agents` folder. */
  static hitsFolder(opts: { command: ISimpleCommand; dir: string; mentions: boolean }): boolean {
    const { program, args } = ShellWrites.programOf(opts);
    const files = args.filter((word) => !word.startsWith('-'));
    const { words } = opts.command;
    const { index } = ShellParser.programOf({ command: opts.command });
    const isFed =
      index > 0 &&
      words.slice(0, index).some((word) => ShellParser.basenameOf({ word }) === 'xargs');

    if (isFed && opts.mentions && ShellWrites.XARGS_WRITERS.has(program)) {
      return true;
    }

    if (ShellWrites.DESTRUCTIVE.has(program)) {
      return files.some((word) => ManifestPath.isFolder({ word }));
    }

    if (program === 'ln') {
      return files.length > 1 && ManifestPath.isFolder({ word: files[files.length - 1] ?? '' });
    }

    if (ShellWrites.COPIERS.has(program)) {
      return ShellWrites.copiesOntoFolder({ program, args, files, dir: opts.dir });
    }

    switch (program) {
      case 'find': {
        return ShellWrites.findsManifest({ args, dir: opts.dir });
      }
      case 'tar': {
        return opts.mentions && ShellWrites.isExtracting({ args });
      }
      case 'unzip': {
        return opts.mentions && !args.some((word) => /^-[ltpZ]$/.test(word));
      }
      default: {
        return false;
      }
    }
  }

  /** Where the shell stands after a simple command: `cd` and `pushd` move it. */
  static folderAfter(opts: { command: ISimpleCommand; dir: string }): string {
    const { program, args } = ShellWrites.programOf(opts);
    const target = args.find((word) => !word.startsWith('-'));

    return (program === 'cd' || program === 'pushd') && target !== undefined && target !== '-'
      ? resolve(opts.dir, target)
      : opts.dir;
  }

  /** The patch files a `patch` command reads: `-i file`, `--input=file`, `-ifile`. */
  static patchFilesOf(opts: { args: string[] }): string[] {
    const files: string[] = [];

    opts.args.forEach((word, index) => {
      if (word === '-i' || word === '--input') {
        files.push(opts.args[index + 1] ?? '-');
      } else if (word.startsWith('--input=')) {
        files.push(word.slice('--input='.length));
      } else if (/^-i./.test(word) && !word.startsWith('--')) {
        files.push(word.slice(2));
      }
    });

    return files;
  }
}

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const toText = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' && opts.value !== '' ? opts.value : undefined;

/** The tool name, with the shell tool of another host read as Claude's `Bash`. */
const toolOf = (opts: { value: unknown }): string | undefined => {
  const name = toText(opts);

  return name !== undefined && SHELL_NAMES.has(name) ? BASH_TOOL : name;
};

export class ManifestGuard {
  /** The tool call from the hook's JSON; `undefined` when it is not what Claude Code sends. */
  static parseHookInput(opts: { text: string }): IManifestHookInput | undefined {
    let payload: unknown;

    try {
      payload = JSON.parse(opts.text);
    } catch (error) {
      console.error(
        `[ManifestGuard.parseHookInput] unreadable hook input - letting the call through | ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }

    const holder = { value: payload };

    if (!isRecord(holder)) {
      return undefined;
    }

    // The wire names are snake_case; they stay behind string-literal access here, at the boundary (V-C-14).
    const toolInput = { value: holder.value['tool_input'] };
    const input = isRecord(toolInput) ? toolInput.value : {};
    const tool = toolOf({ value: holder.value['tool_name'] });

    return tool === undefined
      ? undefined
      : {
          tool,
          filePath:
            toText({ value: input['file_path'] }) ?? toText({ value: input['notebook_path'] }),
          command: toText({ value: input['command'] }),
          cwd: toText({ value: holder.value['cwd'] }),
        };
  }

  /** Whether this tool call writes `.agents/vulcan.manifest.json` - which only `vulcan sync` may do. */
  static inspectWrite(opts: { input: IManifestHookInput }): boolean {
    const { tool, filePath, command, cwd } = opts.input;

    if (tool === BASH_TOOL) {
      return command !== undefined && ManifestGuard.inspectCommand({ command, cwd });
    }

    return filePath !== undefined && ManifestPath.isWriteTarget({ path: filePath, cwd });
  }

  private static inspectSimple(opts: {
    command: ISimpleCommand;
    line: string;
    isNamed: boolean;
    dir: string;
    cwd: string | undefined;
  }): boolean {
    const { command, line, dir, cwd } = opts;
    // The command is about `.agents`: the folder is named in it, or the shell stands in it.
    const mentions = opts.isNamed || basename(dir) === ManifestPath.FOLDER;
    // The words with their quotes taken off, so `vulcan.mani""fest.json` reads as the name it makes.
    const plain = [...command.words, ...command.redirects.map((target) => `> ${target}`)].join(' ');

    if (
      WRITE_PATTERNS.some((pattern) => pattern.test(plain)) ||
      ShellWrites.hitsManifest({ command, dir, mentions }) ||
      ShellWrites.hitsFolder({ command, dir, mentions })
    ) {
      return true;
    }

    const { program, args } = ShellWrites.programOf({ command });

    if (
      program === 'patch' &&
      !args.some((word) => word === '--dry-run' || word === '-C' || word === '--check') &&
      PatchInput.refuses({
        files: ShellWrites.patchFilesOf({ args }),
        heredoc: command.heredoc,
        line,
        dir,
      })
    ) {
      return true;
    }

    const script = InlineScript.scriptOf({ command });

    if (script !== undefined) {
      // A shell that already stands in `.agents` (or below it, reaching up) names no folder in the script.
      const isInsideFolder =
        cwd !== undefined &&
        cwd.split('/').includes(ManifestPath.FOLDER) &&
        (basename(cwd) === ManifestPath.FOLDER || script.text.includes('..'));

      if (InlineScript.writesManifest({ script, dir, line, isInsideFolder })) {
        return true;
      }
    }

    return GitRewrite.rewrites({ command, line, dir, mentions });
  }

  private static inspectCommand(opts: { command: string; cwd: string | undefined }): boolean {
    const { command, cwd } = opts;

    if (WRITE_PATTERNS.some((pattern) => pattern.test(command))) {
      return true;
    }

    const parsed = ShellParser.parseChecked({ command });

    // A line the parser did not read in full is not let through when it can write where the manifest is.
    if (parsed.isOverBudget) {
      return InlineScript.writesInUnreadLine({ line: command });
    }

    let dir = cwd ?? process.cwd();
    const isNamed = InlineScript.mentionsFolder({ text: command });

    for (const simple of parsed.commands) {
      if (ManifestGuard.inspectSimple({ command: simple, line: command, isNamed, dir, cwd })) {
        return true;
      }

      dir = ShellWrites.folderAfter({ command: simple, dir });
    }

    return false;
  }

  static buildDecision() {
    return HookDecision.forHost({
      output: {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          permissionDecision: GuardDecisions.DENY,
          permissionDecisionReason: MANIFEST_BLOCK_MESSAGE,
        },
      },
    });
  }
}
