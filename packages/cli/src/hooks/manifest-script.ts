import { resolve } from 'node:path';
import { ManifestPath } from './manifest-path.ts';

/** How the text of a program is read: calls with arguments (`structured`), or also as plain text (`text`). */
export type TScriptKind = 'structured' | 'text';

export type TShellInspector = (opts: { line: string; dir: string }) => boolean;

interface ICall {
  callee: string;
  name: string;
  args: string[];
}

/**
 * The text a program runs, and the check for a script that writes the manifest. The calls of the script are
 * read one by one: a path that is one plain string (or a name with one plain string behind it) is compared
 * with the manifest as a path; a path built from pieces is refused when a piece of the manifest's name, or
 * `.agents`, is in the command. A command line the script hands to a shell is read as shell code.
 */
export class InlineScript {
  /** Programs whose calls are read one by one: `bun`, `node`, `python3.12` ... */
  static readonly STRUCTURED = /^(?:bunx?|node(?:js)?|deno|tsx|ts-node|python[\d.]*|pypy[\d.]*)$/;
  /** Programs whose text is also searched for a write and a piece of the name. */
  static readonly TEXT = /^(?:ruby|perl|php|lua|luajit|[gmn]?awk|osascript|pwsh|powershell)$/;
  /** The pieces of the name that stay when a script joins it from parts, as letters and digits only. */
  static readonly NAME_PARTS = ['vulcanm', 'manif', 'nifest', 'festjson'];
  static readonly AGENTS = 'agents';
  /** The file name the guard keeps. */
  static readonly MANIFEST_NAME = 'vulcan.manifest.json';
  /** A character of a plain path component. */
  static readonly PLAIN_CHAR = /[\w.@%+,:~-]/;
  /** A variable on its own, `$name` or `${name}`, read at `lastIndex`. */
  static readonly SIMPLE_VARIABLE = /\$(?:[A-Za-z_]\w*|\{[A-Za-z_]\w*\})/y;
  /** What, right after a path, could make it longer or another path: an expansion, a glob, a brace, an escape, a slash. */
  static readonly EXTENDS_PATH = /[$`*?[{(\\/]/;
  static readonly MAX_CALLS = 1000;
  static readonly MAX_CALL_CHARS = 2048;
  static readonly MAX_DEPTH = 3;
  static readonly MODE_WRITES = /[wax+]/;
  static readonly STRING_LITERAL = /^[rRbBuU]{0,2}(['"])((?:\\.|(?!\1)[^\\])*)\1$/s;
  static readonly TEMPLATE_LITERAL = /^`([^`$\\]*)`$/;
  static readonly IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
  /** Words that, in text read with quotes taken out, write, copy, move or remove a file. */
  static readonly TEXT_WORDS = [
    'write',
    'append',
    'copy',
    'rename',
    'unlink',
    'remove',
    'move',
    'link',
    'truncate',
    'shred',
    'open',
    'put_contents',
    'of=',
    '--in-place',
  ];
  static readonly TEXT_PROGRAMS = new Set(['cp', 'mv', 'rm', 'tee', 'install', 'dd']);
  /** Write calls by name (lower-case) and the arguments they change. */
  static readonly CALLS = new Map<string, number[]>([
    ['writefile', [0]],
    ['writefilesync', [0]],
    ['appendfile', [0]],
    ['appendfilesync', [0]],
    ['createwritestream', [0]],
    ['writetextfile', [0]],
    ['writetextfilesync', [0]],
    ['file_put_contents', [0]],
    ['unlink', [0]],
    ['unlinksync', [0]],
    ['rm', [0]],
    ['rmsync', [0]],
    ['rmdir', [0]],
    ['rmdirsync', [0]],
    ['rmtree', [0]],
    ['remove', [0]],
    ['truncate', [0]],
    ['truncatesync', [0]],
    ['copyfile', [1]],
    ['copyfilesync', [1]],
    ['cp', [1]],
    ['cpsync', [1]],
    ['copy', [1]],
    ['copy2', [1]],
    ['copytree', [1]],
    ['symlink', [1]],
    ['symlinksync', [1]],
    ['link', [1]],
    ['linksync', [1]],
    ['rename', [0, 1]],
    ['renamesync', [0, 1]],
    ['move', [0, 1]],
    ['open', [0]],
    ['opensync', [0]],
    ['file.write', [0]],
    ['file.binwrite', [0]],
    ['file.delete', [0]],
    ['file.rename', [0, 1]],
    ['bun.write', [0]],
    ['os.replace', [0, 1]],
    ['fileinput.input', [0]],
  ]);
  /** Calls that copy a whole tree: their destination is the folder the tree goes into. */
  static readonly TREE_CALLS = new Set(['copytree', 'cp', 'cpsync']);
  /** Calls that hand a command line to a shell. */
  static readonly SHELL_CALLS = new Set([
    'exec',
    'execsync',
    'execfile',
    'execfilesync',
    'spawn',
    'spawnsync',
    'system',
    'popen',
    'shell_exec',
    'passthru',
    'proc_open',
    'subprocess.run',
    'subprocess.call',
    'subprocess.check_call',
    'subprocess.check_output',
    'subprocess.popen',
    'os.system',
    'os.popen',
    'bun.spawn',
    'bun.spawnsync',
  ]);
  /** Calls that run text as code. */
  static readonly CODE_CALLS = new Set(['exec', 'eval', 'function']);
  /** Calls whose path is not among their arguments (`Path(p).write_text(..)`, `Bun.file(p).writer()`). */
  static readonly UNKNOWN_TARGET = /\.(?:writer|write_text|write_bytes|writeText)\s*\(/;
  /** Names that, joined into one word, are a file write (for a call whose name is computed). */
  static readonly CALL_LETTERS = [
    'writefile',
    'appendfile',
    'copyfile',
    'createwritestream',
    'renamesync',
    'unlinksync',
    'rmsync',
    'bunwrite',
    'shutilcopy',
    'shutilmove',
    'shutilrmtree',
    'osrename',
    'osremove',
    'osreplace',
    'writetext',
    'writebytes',
    'fileputcontents',
  ];
  /** The verbs that make a line the parser could not read worth refusing. */
  static readonly UNREAD_WORDS = new Set([
    'tee',
    'cp',
    'mv',
    'install',
    'ln',
    'rm',
    'dd',
    'rsync',
    'tar',
    'unzip',
    'patch',
    'sed',
    'perl',
    'ruby',
    'awk',
    'gawk',
    'mawk',
    'python',
    'python3',
    'node',
    'nodejs',
    'bun',
    'bunx',
    'deno',
    'php',
    'lua',
    'sh',
    'bash',
    'zsh',
    'dash',
    'ksh',
    'fish',
    'truncate',
    'shred',
    'unlink',
    'ed',
    'ex',
    'vi',
    'vim',
    'nvim',
    'xargs',
    'find',
    'eval',
    'sponge',
  ]);
  static readonly UNREAD_GIT_WORDS = new Set([
    'checkout',
    'restore',
    'apply',
    'am',
    'stash',
    'reset',
    'merge',
    'cherry-pick',
    'switch',
    'rebase',
    'read-tree',
    'checkout-index',
  ]);

  /** The text with quotes and escapes taken out, so a split string reads as one. */
  private static toPlain(opts: { text: string }): string {
    return opts.text.toLowerCase().replace(/['"`\\]/g, '');
  }

  /** Only letters and digits, so a join (`+`, `.concat`, `join('')`, a template) leaves no gap. */
  static toLetters(opts: { text: string }): string {
    return opts.text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  static hasNamePart(opts: { letters: string }): boolean {
    return InlineScript.NAME_PARTS.some((part) => opts.letters.includes(part));
  }

  /** Whether the text, as letters, mentions `.agents`. */
  static mentionsFolder(opts: { text: string }): boolean {
    return InlineScript.agentsCount(opts) > 0;
  }

  /** How many times the text, as letters, says `agents`. */
  static agentsCount(opts: { text: string }): number {
    return InlineScript.toLetters(opts).split(InlineScript.AGENTS).length - 1;
  }

  /**
   * Whether the whole word is a closed path below a folder named `agents` (`.agents/local/tmp/run.log`,
   * `scripts/agents/tool.ts`): a plain prefix, then plain directories, then a last name that may hold a
   * simple variable or a glob only below a directory. Such a path is neither the folder nor the manifest.
   * It says nothing about the manifest only where it is used as given: an argument or a redirect target,
   * never a value that is put into another word (`G=.agents/local; cd $G/..`).
   * One pass over the word, so a long run of `agents/agents/...` costs no more than its length.
   */
  static isClosedPath(opts: { word: string }): boolean {
    const { word } = opts;
    const lower = word.toLowerCase();

    // A few characters change length in lower case; the offsets would no longer line up.
    if (lower.length !== word.length) {
      return false;
    }

    const at = lower.indexOf(`${InlineScript.AGENTS}/`);

    if (
      at === -1 ||
      ![...word.slice(0, at)].every((char) => char === '/' || InlineScript.PLAIN_CHAR.test(char))
    ) {
      return false;
    }

    const end = InlineScript.closedPathEnd({
      text: word,
      start: at + InlineScript.AGENTS.length + 1,
    });

    return (
      end.kind === 'closed' &&
      end.at === word.length &&
      !InlineScript.hasNamePart({ letters: InlineScript.toLetters({ text: word }) })
    );
  }

  /**
   * Where the components that begin at `start` stop, and whether the path they make is closed: plain
   * directories, then a last name that may hold a simple variable or a glob (`.agents/plans/$n.hashes`,
   * `.agents/plans/*.json`) but only below a directory, since one expansion or glob never crosses a slash and
   * so cannot reach the file that sits in `.agents` itself.
   */
  private static closedPathEnd(opts: { text: string; start: number }): {
    kind: 'closed' | 'open';
    at: number;
  } {
    const { text } = opts;
    let index = opts.start;
    let depth = 0;
    let afterVariable = -1;

    for (;;) {
      const from = index;

      while (index < text.length && InlineScript.PLAIN_CHAR.test(text.charAt(index))) {
        index += 1;
      }

      const component = text.slice(from, index);

      if (component === '.' || component === '..') {
        return { kind: 'open', at: index };
      }

      if (text.charAt(index) !== '/') {
        break;
      }

      if (component === '') {
        return { kind: 'open', at: index };
      }

      depth += 1;
      index += 1;
    }

    // The last name: plain characters, and below a directory also `$name`, `${name}`, `*` and `?`.
    for (;;) {
      const char = text.charAt(index);

      if (InlineScript.PLAIN_CHAR.test(char)) {
        index += 1;
        continue;
      }

      let length = char === '*' || char === '?' ? 1 : 0;

      if (char === '$') {
        InlineScript.SIMPLE_VARIABLE.lastIndex = index;
        length = InlineScript.SIMPLE_VARIABLE.exec(text)?.[0].length ?? 0;
      }

      if (length === 0) {
        break;
      }

      if (depth === 0) {
        return { kind: 'open', at: index };
      }

      index += length;

      if (char === '$') {
        afterVariable = index;
      }
    }

    // A variable may hold slashes and `..`, so what follows it must not complete the file's name:
    // `$n.hashes` cannot be `vulcan.manifest.json`, but `$n`, `$n.json` and `${n}son` can.
    if (afterVariable !== -1) {
      const suffix = text.slice(afterVariable, index).toLowerCase();

      if (/[*?]/.test(suffix) || InlineScript.MANIFEST_NAME.endsWith(suffix)) {
        return { kind: 'open', at: index };
      }
    }

    // `agents/` with nothing after it is the folder itself.
    if (depth === 0 && index === opts.start) {
      return { kind: 'open', at: index };
    }

    const next = text.charAt(index);

    return {
      kind: next === '' || !InlineScript.EXTENDS_PATH.test(next) ? 'closed' : 'open',
      at: index,
    };
  }

  /**
   * The text a program runs (its arguments but the words in `skip`, and a heredoc), and how to read it;
   * `undefined` when the program is not an interpreter.
   */
  static scriptOf(opts: {
    program: string;
    args: string[];
    heredoc: string | undefined;
    skip: number[];
  }): { text: string; kind: TScriptKind } | undefined {
    const program = opts.program.toLowerCase();
    const text = [
      ...opts.args.filter((_word, index) => !opts.skip.includes(index)),
      opts.heredoc ?? '',
    ].join(' ');

    if (InlineScript.STRUCTURED.test(program)) {
      return { text, kind: 'structured' };
    }

    return InlineScript.TEXT.test(program) ? { text, kind: 'text' } : undefined;
  }

  /** The index of the argument that holds the script (`-e`, `-c`, `--eval`, `eval`), or -1. */
  static payloadOf(opts: { args: string[] }): number {
    if (opts.args[0] === 'eval') {
      return 1;
    }

    const flag = opts.args.findIndex(
      (word) => /^-[A-Za-z]*[ecprE]$/.test(word) || /^--(?:eval|print|command)$/.test(word),
    );

    return flag === -1 ? -1 : flag + 1;
  }

  /** The end of the string literal that opens at `from`, or the index of its last character. */
  private static skipString(opts: { text: string; from: number }): number {
    const quote = opts.text[opts.from];
    let index = opts.from + 1;

    while (index < opts.text.length && opts.text[index] !== quote) {
      index += opts.text[index] === '\\' ? 2 : 1;
    }

    return Math.min(index, opts.text.length - 1);
  }

  /** The arguments of the call whose `(` (or `[`) is at `open`, split at the commas that are not nested. */
  private static argsOf(opts: { text: string; open: number }): string[] {
    const args: string[] = [];
    let depth = 0;
    let start = opts.open + 1;
    const end = Math.min(opts.text.length, opts.open + InlineScript.MAX_CALL_CHARS);

    for (let index = opts.open; index < end; index += 1) {
      const char = opts.text[index] ?? '';

      if (char === '"' || char === "'" || char === '`') {
        index = InlineScript.skipString({ text: opts.text, from: index });
      } else if (char === '(' || char === '[' || char === '{') {
        depth += 1;
      } else if (char === ')' || char === ']' || char === '}') {
        depth -= 1;

        if (depth === 0) {
          args.push(opts.text.slice(start, index).trim());

          return args.filter((arg, position) => arg !== '' || position < args.length - 1);
        }
      } else if (char === ',' && depth === 1) {
        args.push(opts.text.slice(start, index).trim());
        start = index + 1;
      }
    }

    args.push(opts.text.slice(start, end).trim());

    return args;
  }

  private static callsOf(opts: { text: string }): ICall[] {
    const calls: ICall[] = [];

    for (const match of opts.text.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
      if (calls.length >= InlineScript.MAX_CALLS) {
        break;
      }

      const callee = (match[1] ?? '').toLowerCase();
      const open = (match.index ?? 0) + match[0].length - 1;
      const parts = callee.split('.');

      calls.push({
        callee,
        name: parts[parts.length - 1] ?? '',
        args: InlineScript.argsOf({ text: opts.text, open }),
      });
    }

    return calls;
  }

  /** The value of an argument that is one plain string, or `undefined` for an expression. */
  private static literalOf(opts: { arg: string }): string | undefined {
    const quoted = InlineScript.STRING_LITERAL.exec(opts.arg);

    if (quoted !== null) {
      return quoted[2];
    }

    return InlineScript.TEMPLATE_LITERAL.exec(opts.arg)?.[1];
  }

  /** The strings a variable is set to, when every assignment of it in the script is one plain string. */
  private static assignedTo(opts: {
    name: string;
    text: string;
    memo: Map<string, string[] | undefined>;
  }): string[] | undefined {
    if (opts.memo.has(opts.name)) {
      return opts.memo.get(opts.name);
    }

    const name = opts.name.replace(/\$/g, String.raw`\$`);
    const all = Array.from(
      opts.text.matchAll(new RegExp(String.raw`(?:^|[^\w$.])${name}\s*(?::?=)(?!=)`, 'g')),
    );
    const plain = Array.from(
      opts.text.matchAll(
        new RegExp(
          String.raw`(?:^|[^\w$.])${name}\s*(?::?=)\s*(?:'([^'\\]*)'|"([^"\\]*)")(?!\s*[+.%\[(])`,
          'g',
        ),
      ),
      (match) => match[1] ?? match[2] ?? '',
    );

    const values = all.length > 0 && all.length === plain.length ? plain : undefined;

    opts.memo.set(opts.name, values);

    return values;
  }

  /**
   * The paths an expression can be, when they are plain strings: one string, a name set to plain strings, or
   * a path call (`Bun.file`, `Path`, `path.join`) over such values. `undefined` for anything built at run time.
   */
  private static valuesOf(opts: {
    expr: string;
    text: string;
    memo: Map<string, string[] | undefined>;
    depth?: number;
  }): string[] | undefined {
    const depth = opts.depth ?? 0;
    const expr = opts.expr.trim();
    const literal = InlineScript.literalOf({ arg: expr });

    if (literal !== undefined) {
      return [literal];
    }

    if (depth > 4) {
      return undefined;
    }

    if (InlineScript.IDENTIFIER.test(expr)) {
      return InlineScript.assignedTo({ name: expr, text: opts.text, memo: opts.memo });
    }

    const wrapper =
      /^(?:Bun\.file|Path|pathlib\.Path|PurePath|(?:(?:path|os\.path|posixpath|pathlib)\.)?(?:join|resolve|normalize))\s*\(([\s\S]*)\)$/.exec(
        expr,
      );

    if (wrapper === null) {
      return undefined;
    }

    const parts = InlineScript.argsOf({ text: `(${wrapper[1] ?? ''})`, open: 0 }).map((arg) =>
      InlineScript.valuesOf({ expr: arg, text: opts.text, memo: opts.memo, depth: depth + 1 }),
    );

    if (parts.length === 0 || parts.some((part) => part === undefined || part.length !== 1)) {
      return undefined;
    }

    return [parts.map((part) => part?.[0] ?? '').join('/')];
  }

  /** Whether the call opens a file for writing (`open(path, 'w')`); a mode that is not a plain string is a write. */
  private static opensForWrite(opts: { args: string[] }): boolean {
    const modes = opts.args.slice(1);

    if (modes.length === 0) {
      return false;
    }

    return modes.some((arg) => {
      const literal = InlineScript.literalOf({ arg: arg.replace(/^\w+\s*[=:]\s*/, '') });

      return literal === undefined || InlineScript.MODE_WRITES.test(literal);
    });
  }

  /** The path arguments a call changes, or `undefined` when the call is not a write. */
  private static targetsOf(opts: { call: ICall }): string[] | undefined {
    const { call } = opts;
    const indexes = InlineScript.CALLS.get(call.callee) ?? InlineScript.CALLS.get(call.name);

    if (indexes === undefined || call.args.length === 0) {
      return undefined;
    }

    if (call.name === 'input' && !/inplace\s*=\s*(?:True|1)/.test(call.args.join(','))) {
      return undefined;
    }

    if (
      (call.name === 'open' || call.name === 'opensync') &&
      !InlineScript.opensForWrite({ args: call.args })
    ) {
      return undefined;
    }

    return indexes
      .map((index) => call.args[index])
      .filter((arg): arg is string => arg !== undefined);
  }

  /** The command lines a shell call runs, when they are written out; `undefined` when they are built at run time. */
  private static shellLinesOf(opts: { call: ICall }): string[] | undefined {
    const quote = (word: string): string => `'${word.replace(/'/g, String.raw`'\''`)}'`;
    const [first, second] = opts.call.args;
    const program = first === undefined ? undefined : InlineScript.literalOf({ arg: first });

    if (program === undefined && first?.startsWith('[')) {
      const items = InlineScript.argsOf({ text: first, open: 0 }).map((item) =>
        InlineScript.literalOf({ arg: item }),
      );

      return items.length > 0 && items.every((item) => item !== undefined)
        ? [items.map((item) => quote(item ?? '')).join(' ')]
        : undefined;
    }

    if (program === undefined) {
      return undefined;
    }

    if (second?.startsWith('[')) {
      const items = InlineScript.argsOf({ text: second, open: 0 }).map((item) =>
        InlineScript.literalOf({ arg: item }),
      );

      return items.every((item) => item !== undefined)
        ? [[quote(program), ...items.map((item) => quote(item ?? ''))].join(' ')]
        : undefined;
    }

    return [program];
  }

  private static couldBeManifest(opts: { letters: string }): boolean {
    return InlineScript.hasNamePart(opts) || opts.letters.includes(InlineScript.AGENTS);
  }

  /** Whether a script changes the manifest, one call at a time. */
  private static writesViaCalls(opts: {
    text: string;
    dir: string;
    lineLetters: string;
    inspectShell: TShellInspector;
    depth: number;
  }): { writes: boolean; sawWrite: boolean } {
    const { text, lineLetters } = opts;
    const isAbout = InlineScript.couldBeManifest({ letters: lineLetters });
    const calls = InlineScript.callsOf({ text });
    const memo = new Map<string, string[] | undefined>();
    let sawWrite = InlineScript.UNKNOWN_TARGET.test(text);
    let current = opts.dir;

    // More calls than are read: what was not read is not let through.
    if (calls.length >= InlineScript.MAX_CALLS && isAbout) {
      return { writes: true, sawWrite: true };
    }

    if (sawWrite && isAbout) {
      return { writes: true, sawWrite };
    }

    for (const template of text.matchAll(/Bun\.\$\s*`([^`]*)`/g)) {
      sawWrite = true;

      if (opts.inspectShell({ line: template[1] ?? '', dir: current })) {
        return { writes: true, sawWrite };
      }
    }

    for (const call of calls) {
      if (call.name === 'chdir') {
        const values = InlineScript.valuesOf({ expr: call.args[0] ?? '', text, memo });

        if (values?.length === 1) {
          current = resolve(current, values[0] ?? '');
        } else if (isAbout) {
          return { writes: true, sawWrite };
        }

        continue;
      }

      if (InlineScript.SHELL_CALLS.has(call.callee) || InlineScript.SHELL_CALLS.has(call.name)) {
        sawWrite = true;

        const lines = InlineScript.shellLinesOf({ call });

        if (
          lines === undefined
            ? isAbout
            : lines.some((line) => opts.inspectShell({ line, dir: current }))
        ) {
          return { writes: true, sawWrite };
        }
      }

      if (InlineScript.CODE_CALLS.has(call.name) && opts.depth < InlineScript.MAX_DEPTH) {
        const code = InlineScript.literalOf({ arg: call.args[0] ?? '' });

        if (
          code !== undefined &&
          InlineScript.writesViaCalls({
            ...opts,
            text: code.replace(/\\(["'\\])/g, '$1'),
            dir: current,
            depth: opts.depth + 1,
          }).writes
        ) {
          return { writes: true, sawWrite };
        }
      }

      const targets = InlineScript.targetsOf({ call });

      if (targets === undefined) {
        continue;
      }

      sawWrite = true;

      const isTree =
        InlineScript.TREE_CALLS.has(call.name) &&
        (call.name === 'copytree' || /recursive/i.test(call.args.join(',')));

      for (const arg of targets) {
        const values = InlineScript.valuesOf({ expr: arg, text, memo });
        const isHit =
          values === undefined
            ? isAbout
            : values.some(
                (value) =>
                  ManifestPath.isWriteTarget({ path: value, cwd: current }) ||
                  ManifestPath.isFolder({ word: value }) ||
                  (isTree && ManifestPath.holds({ folder: resolve(current, value) })),
              );

        if (isHit) {
          return { writes: true, sawWrite };
        }
      }
    }

    return { writes: false, sawWrite };
  }

  /** Whether the text, read with quotes taken out, writes: a write word, a program that writes, or a redirect. */
  private static hasWrite(opts: { plain: string }): boolean {
    if (InlineScript.TEXT_WORDS.some((word) => opts.plain.includes(word))) {
      return true;
    }

    if (opts.plain.split(/[^a-z0-9_]+/).some((word) => InlineScript.TEXT_PROGRAMS.has(word))) {
      return true;
    }

    for (let index = 0; index < opts.plain.length; index += 1) {
      if (
        opts.plain[index] === '>' &&
        opts.plain[index - 1] !== '=' &&
        opts.plain[index - 1] !== '-' &&
        opts.plain[index + 1] !== '='
      ) {
        return true;
      }
    }

    return false;
  }

  /** Whether a text script writes, holds a piece of the name and sits in a command that mentions `.agents`. */
  private static textWrites(opts: { text: string; context: string; withCalls: boolean }): boolean {
    const letters = InlineScript.toLetters({ text: opts.text });
    const isWrite = opts.withCalls
      ? InlineScript.CALL_LETTERS.some((name) => letters.includes(name))
      : InlineScript.hasWrite({ plain: InlineScript.toPlain({ text: opts.text }) });

    return (
      isWrite &&
      InlineScript.hasNamePart({ letters }) &&
      InlineScript.toLetters({ text: opts.context }).includes(InlineScript.AGENTS)
    );
  }

  /**
   * Whether the script changes the manifest. `isInsideFolder` says the shell already stands in `.agents`, so
   * a script names no folder; `inspectShell` reads a command line the script runs.
   */
  static writesManifest(opts: {
    script: { text: string; kind: TScriptKind };
    dir: string;
    line: string;
    isInsideFolder: boolean;
    inspectShell: TShellInspector;
  }): boolean {
    const { script } = opts;
    const context = opts.isInsideFolder ? `${opts.line} .agents` : opts.line;
    const calls = InlineScript.writesViaCalls({
      text: script.text,
      dir: opts.dir,
      lineLetters: InlineScript.toLetters({ text: context }),
      inspectShell: opts.inspectShell,
      depth: 0,
    });

    if (calls.writes) {
      return true;
    }

    // Text that is not code is read as it is; a call whose name is computed is looked for by its letters.
    if (script.kind === 'text') {
      return InlineScript.textWrites({ text: script.text, context, withCalls: false });
    }

    return (
      !calls.sawWrite && InlineScript.textWrites({ text: script.text, context, withCalls: true })
    );
  }

  /** Whether a line the parser could not read in full mentions `.agents` (or a piece of the name) and holds a write verb. */
  static writesInUnreadLine(opts: { line: string }): boolean {
    const letters = InlineScript.toLetters({ text: opts.line });

    if (!letters.includes(InlineScript.AGENTS) && !InlineScript.hasNamePart({ letters })) {
      return false;
    }

    const lower = opts.line.toLowerCase();

    for (let index = 0; index < lower.length; index += 1) {
      if (lower[index] === '>' && lower[index - 1] !== '=' && lower[index - 1] !== '-') {
        return true;
      }
    }

    const words = lower.split(/[^a-z0-9_.-]+/);

    return (
      words.some((word) => InlineScript.UNREAD_WORDS.has(word)) ||
      (words.includes('git') && words.some((word) => InlineScript.UNREAD_GIT_WORDS.has(word)))
    );
  }
}
