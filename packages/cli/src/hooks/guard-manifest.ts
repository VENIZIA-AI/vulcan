import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IManifestHookInput } from './common/index.ts';
import { HookDecision } from './decision.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

/** The shell tool under the names the hosts give it: Cursor's `Shell`, and a lower-case `bash`. */
const SHELL_NAMES = new Set(['Shell', 'shell', 'bash']);

const MANIFEST_BLOCK_MESSAGE =
  'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`';

const MANIFEST_SUFFIX = '/.agents/vulcan.manifest.json';
const BASH_TOOL = 'Bash';
/** A path word that ends in the manifest's name. */
const TARGET = String.raw`[^\s;|&<>"']*vulcan\.manifest\.json`;

/** The shell forms that write, replace or delete a file; reading it (cat, jq, git diff) is not among them. */
const WRITE_PATTERNS: RegExp[] = [
  // `> file`, `>> file`, `2> file`, `&> file`, `>| file`
  new RegExp(String.raw`(?:^|[^<>])\d?>>?\|?\s*["']?${TARGET}`),
  new RegExp(String.raw`\btee\b[^;|&]*${TARGET}`),
  new RegExp(
    String.raw`\b(?:sed|perl|ruby)\b[^;|&]*\s(?:-[A-Za-z]*i\b|--in-place)[^;|&]*${TARGET}`,
  ),
  // the manifest as the destination: the last argument
  new RegExp(String.raw`\b(?:cp|mv|install|ln)\b[^;|&]*\s["']?${TARGET}["']?\s*(?:$|[;|&])`),
  new RegExp(String.raw`\bof=["']?${TARGET}`),
  new RegExp(String.raw`\b(?:rm|truncate|shred|unlink)\b[^;|&]*${TARGET}`),
];

/** Where a path really points: a link in the path, or in a folder of it, is followed. */
class ManifestPath {
  static readonly MAX_STEPS = 256;

  /** The code of a failed file-system call, or an empty text when the error carries none. */
  static codeOf(opts: { error: unknown }): string {
    return opts.error instanceof Error && 'code' in opts.error ? String(opts.error.code) : '';
  }

  /** Whether the path, as written, ends in the manifest's name (case does not count: some file systems fold it). */
  static isNamed(opts: { path: string }): boolean {
    return normalize(opts.path).toLowerCase().endsWith(MANIFEST_SUFFIX);
  }

  /**
   * The real path of `path`, also when its last parts do not exist yet: the nearest existing folder is
   * resolved and the rest appended, and a link whose target is missing is followed to where it points.
   * `undefined` when it cannot be told (no permission, too many steps).
   */
  static resolveReal(opts: { path: string; steps?: number }): string | undefined {
    const steps = opts.steps ?? 0;

    if (steps > ManifestPath.MAX_STEPS) {
      return undefined;
    }

    try {
      return realpathSync(opts.path);
    } catch (error) {
      const code = ManifestPath.codeOf({ error });

      // A link loop and a path below a plain file name nothing that can be written.
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        return opts.path;
      }

      if (code !== 'ENOENT') {
        console.error(`[ManifestPath.resolveReal] cannot resolve ${opts.path} | ${code}`);

        return undefined;
      }
    }

    const parent = dirname(opts.path);

    if (parent === opts.path) {
      return opts.path;
    }

    const realParent = ManifestPath.resolveReal({ path: parent, steps: steps + 1 });

    if (realParent === undefined) {
      return undefined;
    }

    const candidate = join(realParent, basename(opts.path));

    try {
      const target = readlinkSync(candidate);

      return ManifestPath.resolveReal({
        path: isAbsolute(target) ? target : join(realParent, target),
        steps: steps + 1,
      });
    } catch (error) {
      const code = ManifestPath.codeOf({ error });

      if (code === 'EINVAL' || code === 'ENOENT') {
        return candidate;
      }

      console.error(`[ManifestPath.resolveReal] cannot read the link ${candidate} | ${code}`);

      return undefined;
    }
  }

  /** Whether writing `path` (relative to `cwd`) would change the manifest, by its name or through a link. */
  static isWriteTarget(opts: { path: string; cwd: string | undefined }): boolean {
    const absolute = normalize(
      isAbsolute(opts.path) ? opts.path : join(opts.cwd ?? process.cwd(), opts.path),
    );

    if (ManifestPath.isNamed({ path: absolute })) {
      return true;
    }

    const real = ManifestPath.resolveReal({ path: absolute });

    // A path that cannot be resolved is not let through.
    return real === undefined || ManifestPath.isNamed({ path: real });
  }
}

/**
 * A program that runs the text it is given as a script, and the check for a script that writes the manifest.
 * A script can build the file name from pieces, so the text is read with quotes, joins and punctuation taken
 * out: a piece of the name beside a write call, in a command that mentions `.agents`, is refused.
 */
class InlineScript {
  /** `python3.12`, `bun`, `sh`, `awk` ...: the program name, lower-case, without its path. */
  static readonly PROGRAM =
    /^(?:bunx?|node(?:js)?|deno|tsx|ts-node|python[\d.]*|pypy[\d.]*|ruby|perl|php|lua|luajit|[gmn]?awk|sh|bash|zsh|dash|ksh|csh|tcsh|fish|pwsh|powershell|osascript|eval|sed)$/;
  /** A call or an operator that writes, copies, moves or removes a file, read in the script with quotes taken out. */
  static readonly WRITE_API = new RegExp(
    [
      'write',
      'append',
      String.raw`\bcp`,
      'copy',
      String.raw`\bmv`,
      'move',
      'rename',
      'unlink',
      String.raw`\brm`,
      String.raw`\btee\b`,
      'truncate',
      'shred',
      'link',
      String.raw`\binstall\b`,
      'sponge',
      String.raw`\bdd\b`,
      'of=',
      String.raw`os\.replace`,
      // a redirect, but not `=>`, `->` or `>=`
      String.raw`(?<![=-])>(?!=)`,
      '--in-place',
      String.raw`\s-[a-z]*i[a-z]*\b`,
      // `open(path, 'w')`, `open(path, mode='a')`, `open(path, 'r+')`
      String.raw`open\w*\([^)]*[,=][^),]*[wax+]`,
    ].join('|'),
  );
  /** The pieces of the name that stay when a script joins it from parts, as letters and digits only. */
  static readonly NAME_PARTS = ['vulcanm', 'manif', 'nifest', 'festjson'];
  static readonly AGENTS = 'agents';

  /** The text with quotes and escapes taken out, so a split string reads as one. */
  private static toPlain(opts: { text: string }): string {
    return opts.text.toLowerCase().replace(/['"`\\]/g, '');
  }

  /** Only letters and digits, so a join (`+`, `.concat`, `join('')`, a template) leaves no gap. */
  static toLetters(opts: { text: string }): string {
    return opts.text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** The text a simple command hands to an interpreter (its arguments and a heredoc), or `undefined` for any other program. */
  static scriptOf(opts: { command: ISimpleCommand }): string | undefined {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name }).toLowerCase();

    return InlineScript.PROGRAM.test(program)
      ? [...args, opts.command.heredoc ?? ''].join(' ')
      : undefined;
  }

  /** Whether `script` writes and holds a piece of the manifest's name, in a command (`context`) that is about `.agents`. */
  static writesManifest(opts: { script: string; context: string }): boolean {
    const letters = InlineScript.toLetters({ text: opts.script });

    return (
      InlineScript.WRITE_API.test(InlineScript.toPlain({ text: opts.script })) &&
      InlineScript.NAME_PARTS.some((part) => letters.includes(part)) &&
      InlineScript.toLetters({ text: opts.context }).includes(InlineScript.AGENTS)
    );
  }
}

/** The `git` forms that bring a file back from a revision, a patch or a stash. */
class GitRewrite {
  static readonly SUBCOMMANDS = new Set(['checkout', 'restore', 'apply', 'am', 'stash']);
  static readonly STASH_ACTIONS = new Set(['pop', 'apply', 'branch']);
  /** Options of `git apply` that only look at a patch. */
  static readonly DRY_RUN = new Set(['--check', '--stat', '--numstat', '--summary']);
  static readonly MAX_PATCH_BYTES = 1_048_576;
  static readonly FOLDER = '.agents';
  static readonly NAME = 'vulcan.manifest.json';
  static readonly NAME_LETTERS = 'vulcanmanifestjson';
  static readonly PATH = `${GitRewrite.FOLDER}/${GitRewrite.NAME}`;

  /** A pathspec that is the manifest, the `.agents` folder it is in, or a pattern that matches it. */
  private static covers(opts: { word: string }): boolean {
    const word = opts.word
      .toLowerCase()
      .replace(/^:(?:\([^)]*\)|[/!^]*)/, '')
      .replace(/^(?:\.\/)+/, '')
      .replace(/\/+$/, '');

    if (word === GitRewrite.FOLDER || word.endsWith(`/${GitRewrite.FOLDER}`)) {
      return true;
    }

    if (word === GitRewrite.NAME || word.endsWith(`/${GitRewrite.NAME}`)) {
      return true;
    }

    // A pattern for the whole tree (`.`, `*`) is a different command; one that names part of the path is not.
    if (!/[*?[]/.test(word) || /^[*.]*$/.test(word)) {
      return false;
    }

    try {
      const pattern = new RegExp(
        `^${word
          .replace(/[.+^${}()|\\]/g, String.raw`\$&`)
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
      );

      return pattern.test(GitRewrite.PATH) || pattern.test(GitRewrite.NAME);
    } catch {
      // A pattern that is not a valid expression (an open bracket) may match the name: it is not let through.
      return true;
    }
  }

  /** Whether the text, with git's octal escapes (`\056` for a dot) spelled out, names the manifest. */
  private static namesIn(opts: { text: string }): boolean {
    const decoded = opts.text.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );

    return InlineScript.toLetters({ text: decoded }).includes(GitRewrite.NAME_LETTERS);
  }

  /** Whether the patch file names the manifest; a file too large to read in full, or unreadable, is not let through. */
  private static patchNames(opts: { file: string; cwd: string }): boolean {
    const path = resolve(opts.cwd, opts.file);

    try {
      const stats = statSync(path);

      if (stats.isDirectory()) {
        return false;
      }

      return (
        stats.size > GitRewrite.MAX_PATCH_BYTES ||
        GitRewrite.namesIn({ text: readFileSync(path, 'utf8') })
      );
    } catch (error) {
      const code = ManifestPath.codeOf({ error });

      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return false;
      }

      console.error(`[GitRewrite.patchNames] cannot read ${path} | ${code}`);

      return true;
    }
  }

  /** Whether the stash lists the manifest. `git` is asked, with a time limit; a timeout is not let through. */
  private static stashHolds(opts: { cwd: string; stash: string | undefined }): boolean {
    const ref = opts.stash === undefined ? [] : [opts.stash];
    const spawnOptions = {
      cwd: opts.cwd,
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
        .some((line) => `/${line.trim()}`.toLowerCase().endsWith(`/${GitRewrite.PATH}`))
    );
  }

  /** Whether a patch given as a heredoc, a file argument or a `<` redirect names the manifest. */
  private static appliesManifest(opts: {
    command: ISimpleCommand;
    words: string[];
    line: string;
    cwd: string;
  }): boolean {
    const files = [
      ...opts.words.filter((word) => !word.startsWith('-')),
      ...Array.from(
        opts.line.matchAll(/(?<!<)<(?![<(])\s*([^\s;|&<>()]+)/g),
        (match) => match[1] ?? '',
      ),
    ];

    return (
      opts.words.some((word) => GitRewrite.namesIn({ text: word })) ||
      GitRewrite.namesIn({ text: opts.command.heredoc ?? '' }) ||
      files.some((file) => GitRewrite.patchNames({ file, cwd: opts.cwd }))
    );
  }

  /** Whether this simple command is a `git` form that rewrites the manifest from a revision, a patch or a stash. */
  static rewrites(opts: { command: ISimpleCommand; line: string; cwd: string }): boolean {
    const { name, args } = ShellParser.programOf({ command: opts.command });

    if (ShellParser.basenameOf({ word: name }) !== 'git') {
      return false;
    }

    const at = args.findIndex((word) => GitRewrite.SUBCOMMANDS.has(word));

    if (at === -1) {
      return false;
    }

    const words = args.slice(at + 1);
    const dirAt = args.indexOf('-C');
    const dir = dirAt === -1 ? undefined : args[dirAt + 1];
    const cwd = dir === undefined ? opts.cwd : resolve(opts.cwd, dir);

    switch (args[at]) {
      case 'checkout':
      case 'restore': {
        return words.some((word) => GitRewrite.covers({ word }));
      }
      case 'apply':
      case 'am': {
        const isDryRun =
          words.some((word) => GitRewrite.DRY_RUN.has(word)) && !words.includes('--apply');

        return !isDryRun && GitRewrite.appliesManifest({ ...opts, words, cwd });
      }
      default: {
        const action = words.find((word) => !word.startsWith('-'));
        const stash = words.find((word) => /^(?:stash@\{\d+\}|\d+)$/.test(word));

        return (
          action !== undefined &&
          GitRewrite.STASH_ACTIONS.has(action) &&
          GitRewrite.stashHolds({
            cwd,
            stash: stash !== undefined && /^\d+$/.test(stash) ? `stash@{${stash}}` : stash,
          })
        );
      }
    }
  }
}

/** The programs whose every file argument is written or removed, and those whose last one is. */
const WRITES_EVERY_FILE = new Set(['tee', 'rm', 'truncate', 'shred', 'unlink']);
const WRITES_LAST_FILE = new Set(['cp', 'mv', 'install']);

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

  /** The files a simple command writes, replaces or removes by its own words: its redirects and the arguments of `tee`, `cp`, `mv` and the like. */
  private static targetsOf(opts: { command: ISimpleCommand }): string[] {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name });
    const files = args.filter((word) => !word.startsWith('-'));
    const redirects = opts.command.redirects.filter((target) => !target.startsWith('&'));

    if (WRITES_EVERY_FILE.has(program)) {
      return [...redirects, ...files];
    }

    // Only the last argument of a copy or a move is written; the others are read.
    return WRITES_LAST_FILE.has(program) && files.length > 1
      ? [...redirects, files[files.length - 1] ?? '']
      : redirects;
  }

  private static inspectSimple(opts: {
    command: ISimpleCommand;
    line: string;
    cwd: string | undefined;
  }): boolean {
    const { command, line, cwd } = opts;
    // The words with their quotes taken off, so `vulcan.mani""fest.json` reads as the name it makes.
    const plain = [...command.words, ...command.redirects.map((target) => `> ${target}`)].join(' ');

    if (WRITE_PATTERNS.some((pattern) => pattern.test(plain))) {
      return true;
    }

    if (
      ManifestGuard.targetsOf({ command }).some((path) => ManifestPath.isWriteTarget({ path, cwd }))
    ) {
      return true;
    }

    const script = InlineScript.scriptOf({ command });

    if (script !== undefined) {
      // A shell that already stands in `.agents` (or below it, reaching up) names no folder in the script.
      const isInsideAgents =
        cwd !== undefined &&
        cwd.split('/').includes('.agents') &&
        (basename(cwd) === '.agents' || script.includes('..'));

      if (
        InlineScript.writesManifest({
          script,
          context: isInsideAgents ? `${line} .agents` : line,
        })
      ) {
        return true;
      }
    }

    return GitRewrite.rewrites({ command, line, cwd: cwd ?? process.cwd() });
  }

  private static inspectCommand(opts: { command: string; cwd: string | undefined }): boolean {
    const { command, cwd } = opts;

    if (WRITE_PATTERNS.some((pattern) => pattern.test(command))) {
      return true;
    }

    const parsed = ShellParser.parseChecked({ command });

    // A line the parser did not read in full is read as one script.
    if (parsed.isOverBudget) {
      return InlineScript.writesManifest({ script: command, context: command });
    }

    return parsed.commands.some((simple) =>
      ManifestGuard.inspectSimple({ command: simple, line: command, cwd }),
    );
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
