import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { ManifestPath } from './manifest-path.ts';

/** How the text of a program is read: calls with arguments (`structured`), or as plain text (`text`). */
export type TScriptKind = 'structured' | 'text';

interface ICall {
  callee: string;
  args: string[];
}

/** Where a call writes: the arguments that are paths it changes, by index; `all` when it takes none. */
interface ITargets {
  indexes: number[];
}

/**
 * The text a program runs, and the check for a script that writes the manifest. A script can build the file
 * name from pieces, so a path that is not one plain string is read as letters and digits, with quotes and
 * joins taken out: a piece of the name in it, or `.agents` in the command, is refused. A path that is one
 * plain string is compared with the manifest as a path.
 */
export class InlineScript {
  /** Programs whose calls are read one by one: `bun`, `node`, `python3.12` ... */
  static readonly STRUCTURED = /^(?:bunx?|node(?:js)?|deno|tsx|ts-node|python[\d.]*|pypy[\d.]*)$/;
  /** Programs whose text is searched for a write and a piece of the name. */
  static readonly TEXT = /^(?:ruby|perl|php|lua|luajit|[gmn]?awk|osascript|pwsh|powershell)$/;
  /** The pieces of the name that stay when a script joins it from parts, as letters and digits only. */
  static readonly NAME_PARTS = ['vulcanm', 'manif', 'nifest', 'festjson'];
  static readonly AGENTS = 'agents';
  static readonly MAX_CALLS = 5000;
  static readonly MAX_CALL_CHARS = 8192;
  static readonly MODE_WRITES = /[wax+]/;
  static readonly STRING_LITERAL = /^[rRbBuU]{0,2}(['"])((?:\\.|(?!\1)[^\\])*)\1$/s;
  static readonly TEMPLATE_LITERAL = /^`([^`$\\]*)`$/;
  /** A call or an operator that writes, copies, moves or removes a file, in text read with quotes taken out. */
  static readonly TEXT_WRITES = new RegExp(
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
      String.raw`\bdd\b`,
      'of=',
      String.raw`os\.replace`,
      // a redirect, but not `=>`, `->` or `>=`
      String.raw`(?<![=-])>(?!=)`,
      '--in-place',
      String.raw`open\w*\([^)]*[,=][^),]*[wax+]`,
    ].join('|'),
  );
  /** A script that hands a command line to a shell. */
  static readonly SHELL_OUT =
    /\b(?:exec\w*|spawn\w*|system|popen\w*|subprocess|child_process|run_command)\b|Bun\.\$/i;
  /** Write calls by name (lower-case) and the arguments they change. */
  static readonly CALLS = new Map<string, ITargets>([
    ['writefile', { indexes: [0] }],
    ['writefilesync', { indexes: [0] }],
    ['appendfile', { indexes: [0] }],
    ['appendfilesync', { indexes: [0] }],
    ['createwritestream', { indexes: [0] }],
    ['writetextfile', { indexes: [0] }],
    ['writetextfilesync', { indexes: [0] }],
    ['unlink', { indexes: [0] }],
    ['unlinksync', { indexes: [0] }],
    ['rm', { indexes: [0] }],
    ['rmsync', { indexes: [0] }],
    ['rmdir', { indexes: [0] }],
    ['rmdirsync', { indexes: [0] }],
    ['rmtree', { indexes: [0] }],
    ['remove', { indexes: [0] }],
    ['truncate', { indexes: [0] }],
    ['truncatesync', { indexes: [0] }],
    ['copyfile', { indexes: [1] }],
    ['copyfilesync', { indexes: [1] }],
    ['cp', { indexes: [1] }],
    ['cpsync', { indexes: [1] }],
    ['copy', { indexes: [1] }],
    ['copy2', { indexes: [1] }],
    ['copytree', { indexes: [1] }],
    ['symlink', { indexes: [1] }],
    ['symlinksync', { indexes: [1] }],
    ['link', { indexes: [1] }],
    ['linksync', { indexes: [1] }],
    ['rename', { indexes: [0, 1] }],
    ['renamesync', { indexes: [0, 1] }],
    ['move', { indexes: [0, 1] }],
    ['open', { indexes: [0] }],
    ['opensync', { indexes: [0] }],
  ]);
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
  ];

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
    return InlineScript.toLetters({ text: opts.text }).includes(InlineScript.AGENTS);
  }

  /** The text a simple command hands to an interpreter (its arguments and a heredoc), and how to read it. */
  static scriptOf(opts: {
    command: ISimpleCommand;
  }): { text: string; kind: TScriptKind } | undefined {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const program = ShellParser.basenameOf({ word: name }).toLowerCase();
    const text = [...args, opts.command.heredoc ?? ''].join(' ');

    if (InlineScript.STRUCTURED.test(program)) {
      return { text, kind: 'structured' };
    }

    return InlineScript.TEXT.test(program) ? { text, kind: 'text' } : undefined;
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

  /** The arguments of the call whose `(` is at `open`, split at the commas that are not nested. */
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

      const callee = match[1] ?? '';
      const open = (match.index ?? 0) + match[0].length - 1;

      calls.push({ callee, args: InlineScript.argsOf({ text: opts.text, open }) });
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
    const parts = opts.call.callee.split('.');
    const name = (parts[parts.length - 1] ?? '').toLowerCase();
    const callee = opts.call.callee.toLowerCase();
    const isBunWrite = callee === 'bun.write';
    const isOsReplace = callee === 'os.replace';
    const targets = InlineScript.CALLS.get(name);

    if (!isBunWrite && !isOsReplace && targets === undefined) {
      return undefined;
    }

    if (opts.call.args.length === 0) {
      return undefined;
    }

    if (
      (name === 'open' || name === 'opensync') &&
      !InlineScript.opensForWrite({ args: opts.call.args })
    ) {
      return undefined;
    }

    const indexes = isOsReplace ? [0, 1] : (targets?.indexes ?? [0]);

    return indexes
      .map((index) => opts.call.args[index])
      .filter((arg): arg is string => arg !== undefined);
  }

  /** Whether a path that is not one plain string could be the manifest: a piece of the name, or `.agents`, is in play. */
  private static couldBeManifest(opts: { letters: string }): boolean {
    return InlineScript.hasNamePart(opts) || opts.letters.includes(InlineScript.AGENTS);
  }

  /** Whether a structured script changes the manifest, one write call at a time. */
  private static writesViaCalls(opts: {
    text: string;
    dir: string;
    line: string;
    isInsideFolder: boolean;
  }): { writes: boolean; sawWrite: boolean } {
    const lineLetters = `${InlineScript.toLetters({ text: opts.line })}${opts.isInsideFolder ? InlineScript.AGENTS : ''}`;
    let sawWrite = InlineScript.UNKNOWN_TARGET.test(opts.text);

    if (sawWrite && InlineScript.couldBeManifest({ letters: lineLetters })) {
      return { writes: true, sawWrite };
    }

    const calls = InlineScript.callsOf({ text: opts.text });

    // More calls than are read: what was not read is not let through.
    if (
      calls.length >= InlineScript.MAX_CALLS &&
      InlineScript.couldBeManifest({ letters: lineLetters })
    ) {
      return { writes: true, sawWrite: true };
    }

    for (const call of calls) {
      const targets = InlineScript.targetsOf({ call });

      if (targets === undefined) {
        continue;
      }

      sawWrite = true;

      for (const arg of targets) {
        const literal = InlineScript.literalOf({ arg });
        const isManifest =
          literal === undefined
            ? InlineScript.couldBeManifest({ letters: lineLetters })
            : ManifestPath.isWriteTarget({ path: literal, cwd: opts.dir }) ||
              ManifestPath.isFolder({ word: literal });

        if (isManifest) {
          return { writes: true, sawWrite };
        }
      }
    }

    return { writes: false, sawWrite };
  }

  /** Whether a text script writes, holds a piece of the name and sits in a command that mentions `.agents`. */
  private static textWrites(opts: { text: string; context: string; withCalls: boolean }): boolean {
    const letters = InlineScript.toLetters({ text: opts.text });
    const isWrite = opts.withCalls
      ? InlineScript.CALL_LETTERS.some((name) => letters.includes(name))
      : InlineScript.TEXT_WRITES.test(InlineScript.toPlain({ text: opts.text }));

    return (
      isWrite &&
      InlineScript.hasNamePart({ letters }) &&
      InlineScript.toLetters({ text: opts.context }).includes(InlineScript.AGENTS)
    );
  }

  /**
   * Whether the script changes the manifest. `context` is the command line, and `isInsideFolder` says the
   * shell already stands in `.agents`, so a script names no folder.
   */
  static writesManifest(opts: {
    script: { text: string; kind: TScriptKind };
    dir: string;
    line: string;
    isInsideFolder: boolean;
  }): boolean {
    const { script, line } = opts;
    const context = opts.isInsideFolder ? `${line} .agents` : line;

    if (script.kind === 'text') {
      return InlineScript.textWrites({ text: script.text, context, withCalls: false });
    }

    const calls = InlineScript.writesViaCalls({
      text: script.text,
      dir: opts.dir,
      line,
      isInsideFolder: opts.isInsideFolder,
    });

    if (calls.writes) {
      return true;
    }

    // A script that hands a command line to a shell is read as that line would be.
    if (
      InlineScript.SHELL_OUT.test(script.text) &&
      InlineScript.textWrites({ text: script.text, context, withCalls: false })
    ) {
      return true;
    }

    // No write call could be read: a call whose name is computed is looked for by its letters.
    return (
      !calls.sawWrite && InlineScript.textWrites({ text: script.text, context, withCalls: true })
    );
  }

  /** Whether a line the parser could not read in full mentions `.agents` (or a piece of the name) and holds a write verb. */
  static writesInUnreadLine(opts: { line: string }): boolean {
    const letters = InlineScript.toLetters({ text: opts.line });

    return (
      (letters.includes(InlineScript.AGENTS) || InlineScript.hasNamePart({ letters })) &&
      InlineScript.UNREAD_VERBS.test(opts.line.toLowerCase())
    );
  }

  static readonly UNREAD_VERBS = new RegExp(
    [
      String.raw`(?<![=-])>`,
      String.raw`\b(?:tee|cp|mv|install|ln|rm|dd|rsync|tar|unzip|patch|sed|perl|ruby|awk|gawk|mawk|python[\d.]*|node|nodejs|bun|bunx|deno|php|lua|sh|bash|zsh|dash|ksh|fish|truncate|shred|unlink|ed|ex|vi|vim|nvim|xargs|find|eval)\b`,
      String.raw`\bgit\b[^;|&]*\b(?:checkout|restore|apply|am|stash|reset|merge|cherry-pick|switch|rebase)\b`,
    ].join('|'),
  );
}
