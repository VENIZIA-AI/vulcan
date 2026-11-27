import type {
  IBudget,
  ICommandInput,
  IHeredoc,
  IParsedShell,
  IShellLayout,
  ISimpleCommand,
} from './common/index.ts';
import { ShellBudget, ShellConstants } from './common/index.ts';
import { NestedScripts } from './nested-scripts.ts';
import { ShellPrograms } from './shell-programs.ts';
import { ShellScanner } from './shell-scanner.ts';
import { ShellWordUtility } from './utilities/shell-word.utility.ts';

const inputOf = (opts: { command: ISimpleCommand }): ICommandInput => {
  opts.command.input ??= { files: [], texts: [], hasHeredoc: false };

  return opts.command.input;
};

/** The keywords that end a compound command: a redirect after one belongs to the whole command. */
const CLOSING_KEYWORDS = new Set(['}', 'fi', 'done', 'esac']);

/** The mark of an open `case` among the groups the parser tracks: its `)` closes a pattern. */
const CASE_GROUP = 'case';

/** Why a guard could not read a line in full: it asks, because an unread part is never an allow. */
export class ShellUnread {
  /** The line is over `ShellBudget`, or nests past the depth limit. */
  static readonly OVER_BUDGET =
    'this command line is larger, or nests deeper, than the guard reads, so it could not be checked';
  /** The scanner could not follow part of the line to its end. */
  static readonly UNCERTAIN =
    'this command line has a quote, substitution or heredoc that does not close, or a form the guard does not follow, so it could not be checked';

  /** A command runs a program the line does not show: a variable or a substitution in its place. */
  static readonly UNKNOWN_PROGRAM =
    'a command on this line runs a program named by a variable, a substitution, a glob or a brace pattern, or runs a ${var@P} expansion, so it could not be checked';

  /** The reason a parse was not read in full, or `undefined` when all of it was read. */
  static reasonOf(opts: {
    isOverBudget: boolean;
    isUncertain: boolean;
    hasUnknownProgram: boolean;
  }): string | undefined {
    if (opts.isOverBudget) {
      return ShellUnread.OVER_BUDGET;
    }

    if (opts.isUncertain) {
      return ShellUnread.UNCERTAIN;
    }

    return opts.hasUnknownProgram ? ShellUnread.UNKNOWN_PROGRAM : undefined;
  }
}

export class ShellParser {
  /**
   * Whether a word of the command is `${x@P}`, which runs the commands in the value of `x` wherever it stands, an
   * `echo` argument included.
   */
  static hasPromptExpansion(opts: { command: ISimpleCommand }): boolean {
    return [
      ...opts.command.words,
      ...opts.command.assignments,
      ...(opts.command.expandedBodies ?? []),
    ].some((text) => /\$\{[^}]*@P\}/.test(text));
  }

  /**
   * Whether a command's program is a variable, a substitution, a glob or a brace pattern, which the line does not show. An expansion
   * anywhere in the word counts, not only in its last part: an unquoted `$k/deploy.yaml` is split at the blanks
   * of `k`, so its first word is the program. No variable is exempt, `HOME` included: the same line can set it.
   */
  static isUnknownProgram(opts: { command: ISimpleCommand }): boolean {
    const { name } = ShellPrograms.programOf({ command: opts.command });

    return (
      /[$`*?]/.test(name) ||
      /\[[^\]]+\]/.test(name) ||
      /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(name) ||
      name.startsWith('<(') ||
      name.startsWith('>(') ||
      ShellParser.hasPromptExpansion({ command: opts.command })
    );
  }

  /**
   * The simple commands of a shell line, in order: `;`, `&&`, `||`, `|`, `&` and newlines split them;
   * `$(...)`, backticks, `sh -c '...'` arguments and the command line of `env -S` are parsed as commands too. It
   * reads quoting, not every corner of the shell: a line it cannot follow yields fewer commands, never an error.
   */
  private static parseWithBudget(opts: {
    command: string;
    depth: number;
    budget: IBudget;
    scope?: string;
    carrier?: ISimpleCommand;
  }): ISimpleCommand[] {
    const { depth, budget } = opts;
    const base = opts.scope ?? '';

    // The characters of every text read count together, nested texts too: a line over the cap is not read.
    budget.chars += opts.command.length;

    if (budget.chars > ShellBudget.MAX_CHARS) {
      budget.isOver = true;

      return [];
    }

    const layout = ShellParser.layoutOf({ command: opts.command });
    const { text } = layout;

    budget.isUncertain ||= layout.isUncertain;

    const commands: ISimpleCommand[] = [];
    const nestedTexts: { text: string; scope: string; carrier: ISimpleCommand }[] = [];
    let current: ISimpleCommand = { words: [], redirects: [], assignments: [] };
    let index = 0;
    // The command before a `|`: it feeds the next one.
    let pipeSource: ISimpleCommand | undefined;
    // The open subshells, and a `case` marker while its `)` patterns are read.
    const groups: string[] = [];
    const scopeOf = (): string =>
      `${base}${groups.filter((group) => group !== CASE_GROUP).join('')}`;
    const nest = (nested: { texts: string[] }): void => {
      for (const nestedText of nested.texts) {
        nestedTexts.push({ text: nestedText, scope: scopeOf(), carrier: current });
      }
    };

    const finish = (): ISimpleCommand | undefined => {
      const finished = current;
      const isEmpty =
        finished.words.length === 0 &&
        finished.redirects.length === 0 &&
        finished.assignments.length === 0;

      if (!isEmpty) {
        if (pipeSource !== undefined) {
          inputOf({ command: finished }).pipedFrom = pipeSource;
        }

        const scope = scopeOf();

        if (scope !== '') {
          finished.scope = scope;
        }

        if (opts.carrier !== undefined) {
          finished.carrier = opts.carrier;
        }

        commands.push(finished);
      }

      pipeSource = undefined;
      current = { words: [], redirects: [], assignments: [] };

      return isEmpty ? undefined : finished;
    };

    while (index < text.length) {
      const char = text[index];

      if (char === ' ' || char === '\t') {
        index += 1;
        continue;
      }

      // A backslash before a newline joins the lines: both vanish.
      if (char === '\\' && text[index + 1] === '\n') {
        index += 2;
        continue;
      }

      // `||` runs the next command after this one; `|` and `|&` feed this one's output into it.
      if (char === '|') {
        if (text[index + 1] === '|') {
          finish();
          index += 2;
          continue;
        }

        const source = finish();

        pipeSource = source;
        index += text[index + 1] === '&' ? 2 : 1;
        continue;
      }

      // `(( ... ))` is arithmetic: only the substitutions inside it are commands.
      const arithmeticEnd = char === '(' ? layout.ariths.get(index) : undefined;

      if (arithmeticEnd !== undefined) {
        finish();
        nest({
          texts: ShellWordUtility.substitutionsIn({ text, from: index, to: arithmeticEnd, layout }),
        });
        index = arithmeticEnd + 1;
        continue;
      }

      if (char === ';' || char === '\n') {
        finish();
        index += 1;
        continue;
      }

      // A `(` opens a subshell; a `)` closes it, unless it ends a pattern of an open `case`.
      if (char === '(' || char === ')') {
        finish();

        if (char === '(') {
          budget.scopes += 1;
          groups.push(`/${budget.scopes}`);
        } else if (groups.length > 0 && groups.at(-1) !== CASE_GROUP) {
          groups.pop();
        }

        index += 1;
        continue;
      }

      if (char === '&' && text[index + 1] !== '>') {
        finish();
        index += 1;
        continue;
      }

      // `<(...)` and `>(...)`: a process substitution is a word (a path the command reads or writes), its text
      // commands of their own.
      const substitutionEnd =
        (char === '<' || char === '>') && text[index + 1] === '('
          ? layout.closes.get(index)
          : undefined;

      if (substitutionEnd !== undefined) {
        nest({ texts: [text.slice(index + 2, substitutionEnd)] });
        current.words.push(text.slice(index, substitutionEnd + 1));
        index = substitutionEnd + 1;
        continue;
      }

      // A heredoc, read by the scanner: the delimiter is part of the operator, not a word, and the body goes to
      // the command that reads it.
      const heredoc = char === '<' ? layout.heredocAt.get(index) : undefined;

      if (heredoc !== undefined) {
        inputOf({ command: current }).hasHeredoc = true;

        if (!heredoc.heredoc.isInline) {
          current.heredoc = heredoc.heredoc.body;
        }

        if (!heredoc.isQuoted) {
          (current.expandedBodies ??= []).push(heredoc.heredoc.body);
        }

        nest({ texts: heredoc.substitutions });
        index = heredoc.end;
        continue;
      }

      if (char === '>' || char === '&') {
        // `>`, `>>`, `>|`, `&>`, `&>>`; `>&2` duplicates a descriptor and names no file.
        let cursor = index + (char === '&' ? 1 : 0);

        while (text[cursor] === '>' || text[cursor] === '|') {
          cursor += 1;
        }

        // `>&2` and `>&-` duplicate or close a descriptor; `>&file` writes the file, as `&>file` does.
        const isAmpersand = char === '>' && text[cursor] === '&';

        if (isAmpersand) {
          cursor += 1;
        }

        while (text[cursor] === ' ' || text[cursor] === '\t') {
          cursor += 1;
        }

        const target = ShellWordUtility.readWord({ text, from: cursor, layout });

        if (isAmpersand && /^(?:\d+-?|-)$/.test(target.value)) {
          nest({ texts: target.nested });
          index = Math.max(target.next, cursor + 1);
          continue;
        }

        if (target.value !== '') {
          current.redirects.push(target.value);
          ShellWordUtility.markLiteralDollar({
            command: current,
            value: target.value,
            read: target,
          });

          if (isAmpersand && /[$`]/.test(target.value)) {
            (current.copies ??= []).push(target.value);
          }
        }

        nest({ texts: target.nested });
        index = Math.max(target.next, cursor + 1);
        continue;
      }

      if (char === '<') {
        // `<<< text`: a here-string, its text fed to the command.
        if (text[index + 1] === '<' && text[index + 2] === '<') {
          let cursor = index + 3;

          while (text[cursor] === ' ' || text[cursor] === '\t') {
            cursor += 1;
          }

          const value = ShellWordUtility.readWord({ text, from: cursor, layout });

          inputOf({ command: current }).texts.push(value.value);
          nest({ texts: value.nested });
          index = Math.max(value.next, cursor);
          continue;
        }

        // A `<<` the scanner did not read as a heredoc (it has no delimiter) names no file.
        if (text[index + 1] === '<') {
          index += 2;
          continue;
        }

        let cursor = index + 1;

        // `<&3` and `<&-` duplicate or close a descriptor and name no file.
        if (text[cursor] === '&') {
          index = cursor + 2;
          continue;
        }

        // `<>` opens the file for reading and writing: it is a write target too.
        const isReadWrite = text[cursor] === '>';

        if (isReadWrite) {
          cursor += 1;
        }

        while (text[cursor] === ' ' || text[cursor] === '\t') {
          cursor += 1;
        }

        // The file stays a word of the command too, where the guards that read words have always found it.
        const source = ShellWordUtility.readWord({ text, from: cursor, layout });

        if (source.value !== '') {
          inputOf({ command: current }).files.push(source.value);
          ShellWordUtility.markLiteralDollar({
            command: current,
            value: source.value,
            read: source,
          });

          if (isReadWrite) {
            current.redirects.push(source.value);
          }

          const isClosing =
            current.words.length === 1 && CLOSING_KEYWORDS.has(current.words[0] ?? '');

          if (current.words.length > 0 && !isClosing) {
            current.words.push(source.value);
          }
        }

        nest({ texts: source.nested });
        index = Math.max(source.next, index + 1);
        continue;
      }

      const word = ShellWordUtility.readWord({ text, from: index, layout });

      // A digit just before `>` is a descriptor (`2>file`), not a word.
      if (/^\d+$/.test(word.value) && (text[word.next] === '>' || text[word.next] === '<')) {
        index = word.next;
        continue;
      }

      nest({ texts: word.nested });

      const isFirst = current.words.length === 0;

      // In `case x in a) ...;; esac` each `)` ends a pattern, not a subshell.
      if (isFirst && word.value === 'case') {
        groups.push(CASE_GROUP);
      } else if (isFirst && word.value === 'esac' && groups.includes(CASE_GROUP)) {
        groups.splice(groups.lastIndexOf(CASE_GROUP));
      }

      ShellWordUtility.markLiteralDollar({ command: current, value: word.value, read: word });

      if (isFirst && ShellWordUtility.isAssignment({ word: word.value })) {
        current.assignments.push(word.value);
      } else {
        current.words.push(word.value);
      }

      index = Math.max(word.next, index + 1);
    }

    finish();

    budget.hasUnknownProgram ||= commands.some((command) =>
      ShellParser.isUnknownProgram({ command }),
    );

    // A body whose delimiter never came is data, as bash reads it; its lines are also read as commands, on the side. The
    // guards ask: a start the scanner got wrong would otherwise hide what follows it.
    if (layout.unterminated.length > 0) {
      budget.isUncertain = true;
    }

    for (const body of layout.unterminated) {
      ShellWordUtility.pushAll({
        target: budget.unterminated,
        items: ShellParser.parseWithBudget({ command: body, depth: depth + 1, budget }),
      });
    }

    budget.commands += commands.length;
    budget.words += commands.reduce((sum, command) => sum + command.words.length, 0);

    if (budget.commands > ShellBudget.MAX_COMMANDS || budget.words > ShellBudget.MAX_WORDS) {
      budget.isOver = true;

      return commands;
    }

    // At the depth limit nothing nests further; a command that would is a part of the line left unread.
    if (depth >= ShellConstants.MAX_DEPTH) {
      budget.isOver ||=
        nestedTexts.length > 0 || commands.some((command) => NestedScripts.nests({ command }));

      return commands;
    }

    // `env -S "git push -f origin main"` is a command line in one word: the command it makes joins the queue,
    // one nesting level deeper, and is read like any other.
    const synthesized: ISimpleCommand[] = [];
    const queue = commands.map((command) => ({ command, level: 0 }));

    for (const { command, level } of queue) {
      const program = ShellPrograms.programOf({ command });

      if (depth + level < ShellConstants.MAX_DEPTH) {
        for (const words of program.splitCommands) {
          const split: ISimpleCommand = { words, redirects: [], assignments: [] };

          if (command.scope !== undefined) {
            split.scope = command.scope;
          }

          budget.commands += 1;
          budget.words += words.length;

          if (budget.commands > ShellBudget.MAX_COMMANDS || budget.words > ShellBudget.MAX_WORDS) {
            budget.isOver = true;

            return [...commands, ...synthesized];
          }

          budget.hasUnknownProgram ||= ShellParser.isUnknownProgram({ command: split });
          synthesized.push(split);
          queue.push({ command: split, level: level + 1 });
        }
      } else if (program.splitCommands.length > 0) {
        budget.isOver = true;
      }

      for (const script of NestedScripts.nestedScripts({ command, program })) {
        nestedTexts.push({ text: script, scope: command.scope ?? base, carrier: command });
      }
    }

    return [
      ...commands,
      ...synthesized,
      ...nestedTexts.flatMap((nested) => {
        budget.scopes += 1;

        return ShellParser.parseWithBudget({
          command: nested.text,
          depth: depth + 1,
          budget,
          scope: `${nested.scope}>${budget.scopes}`,
          carrier: nested.carrier,
        });
      }),
    ];
  }

  /** A parse that throws (a stack or memory limit) reads nothing and says so: the line is not allowed by silence. */
  private static parseGuarded(opts: {
    command: string;
    depth: number;
    budget: IBudget;
  }): ISimpleCommand[] {
    try {
      return ShellParser.parseWithBudget(opts);
    } catch {
      opts.budget.isOver = true;

      return [];
    }
  }

  /**
   * A heredoc's body is data for the command that reads it (a commit message, a file), not commands: the
   * body is taken out of the text and kept in `heredocs`, in order, for the command to carry. A body fed to a
   * shell (`bash <<EOF`) is a script: it stays in the text and is read as commands. The text is read left to
   * right as bash reads it, so a `<<` in a comment, in arithmetic or in a quote that spans lines starts no
   * heredoc, and a comment is dropped from the text. `isUncertain` says part of it could not be followed to
   * its end (a quote or a substitution that never closes, a `<<` with no delimiter).
   */
  static splitHeredocs(opts: { command: string }): {
    text: string;
    heredocs: IHeredoc[];
    isUncertain: boolean;
  } {
    const layout = ShellParser.layoutOf(opts);

    return { text: layout.view, heredocs: layout.heredocs, isUncertain: layout.isUncertain };
  }

  /** What the scanner finds in a line, every position an index of its kept text. */
  private static layoutOf(opts: { command: string }): IShellLayout {
    return ShellScanner.scan({
      text: opts.command,
      depth: 0,
      isBody: false,
      programBefore: (scanned) => NestedScripts.programBefore(scanned),
    });
  }

  /**
   * The commands of a line and whether all of it was read. A guard that can refuse treats `isOverBudget`
   * and `isUncertain` as "ask" (`ShellUnread.reasonOf`): an unread part is never an "allow".
   */
  static parseChecked(opts: { command: string }): IParsedShell {
    const budget = ShellParser.budgetOf();
    const commands = ShellParser.parseGuarded({ command: opts.command, depth: 0, budget });

    return {
      commands,
      isOverBudget: budget.isOver,
      isUncertain: budget.isUncertain,
      hasUnknownProgram: budget.hasUnknownProgram,
      unterminatedHeredocCommands: budget.unterminated,
    };
  }

  static parse(opts: { command: string; depth?: number }): ISimpleCommand[] {
    return ShellParser.parseGuarded({
      command: opts.command,
      depth: opts.depth ?? 0,
      budget: ShellParser.budgetOf(),
    });
  }

  private static budgetOf(): IBudget {
    return {
      commands: 0,
      words: 0,
      chars: 0,
      scopes: 0,
      isOver: false,
      isUncertain: false,
      hasUnknownProgram: false,
      unterminated: [],
    };
  }
}
