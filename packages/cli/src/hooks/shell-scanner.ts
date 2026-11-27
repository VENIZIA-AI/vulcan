import type { TConstValue } from '../common/types.ts';
import type { IHeredoc, IShellLayout } from './common/index.ts';
import { ShellBudget, ShellConstants } from './common/index.ts';
import { ShellPrograms } from './shell-programs.ts';
import { ShellScanUtility } from './utilities/shell-scan.utility.ts';
import { ShellWordUtility } from './utilities/shell-word.utility.ts';

/** What the scanner can be inside. */
class ScanKinds {
  /** Commands: the line itself, `$(...)`, `<(...)`, `>(...)`. */
  static readonly COMMAND = 'command';
  static readonly BACKTICK = 'backtick';
  static readonly DOUBLE = 'double';
  /** `$((...))`, `((...))` and `$[...]`. */
  static readonly ARITHMETIC = 'arithmetic';
  /** `${...}`. */
  static readonly BRACE = 'brace';
  /** The body of a heredoc whose delimiter is not quoted: only substitutions mean something in it. */
  static readonly BODY = 'body';
}

type TScanKind = TConstValue<typeof ScanKinds>;

/** A heredoc whose operator was read and whose body starts at the next newline of its context. */
interface IPendingHeredoc {
  delimiter: string;
  stripTabs: boolean;
  isQuoted: boolean;
  /** The operator in the kept text: where it starts and where it ends. */
  at: number;
  end: number;
  /** A shell reads the body as commands (`bash <<EOF`). */
  isInline: boolean;
}

interface IScanContext {
  kind: TScanKind;
  /** Where the opener starts in the kept text: the key of `closes` or `ariths`. */
  at: number;
  /** What closes it: `)`, a backtick, `))`, `]`, `}`, `"`, or nothing for the outermost text. */
  close: string;
  /** Parentheses, brackets or braces opened inside it and not closed yet. */
  depth: number;
  pending: IPendingHeredoc[];
  /** Where its current command starts in the kept text, and the program found for the command that starts there. */
  commandStart: number;
  program: { start: number; name: string };
  isOuter: boolean;
  /** Inside double quotes, where a single quote is a character. */
  isQuoted: boolean;
  /** The `case` commands opened in it and not yet closed by `esac`: a `)` there ends a pattern. */
  cases: number;
}

interface IScanOptions {
  text: string;
  /** The heredoc bodies read as scripts around the text. */
  depth: number;
  /** The text is a heredoc body, where only substitutions mean something. */
  isBody: boolean;
  /** The program of the command that starts at `from` in `text`: a shell reads its heredoc body as commands. */
  programBefore: (opts: { text: string; from: number; layout: IShellLayout }) => string;
}

/** The characters before which a `#` starts a comment and `((` starts arithmetic. */
const WORD_STARTS = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);

/**
 * Reads a text left to right the way bash does, once: quotes (single, double, `$'...'`, backticks), `$(...)` and
 * `${...}` nesting, arithmetic, escapes and comments, across lines. It finds each heredoc (a `<<WORD` outside
 * quotes, comments and arithmetic) and its body, which starts at the next newline of the same context and ends
 * at the delimiter line. Whatever it cannot follow to its end it flags, and never hides.
 */
export class ShellScanner {
  /** Moves every position of `from` by `shift` into `into`: a text scanned apart and spliced in. */
  private static merge(opts: { into: IShellLayout; from: IShellLayout; shift: number }): void {
    const { into, from, shift } = opts;

    ShellWordUtility.pushAll({ target: into.heredocs, items: from.heredocs });
    ShellWordUtility.pushAll({ target: into.unterminated, items: from.unterminated });
    into.isUncertain ||= from.isUncertain;

    for (const [at, heredoc] of from.heredocAt) {
      into.heredocAt.set(at + shift, { ...heredoc, end: heredoc.end + shift });
    }

    for (const [at, end] of from.closes) {
      into.closes.set(at + shift, end + shift);
    }

    for (const [at, end] of from.ariths) {
      into.ariths.set(at + shift, end + shift);
    }
  }

  /** The substitutions bash runs in a heredoc body whose delimiter is not quoted. */
  private static substitutionsOfBody(opts: { body: string; scan: IScanOptions }): {
    texts: string[];
    isUncertain: boolean;
  } {
    const layout = ShellScanner.scan({
      ...opts.scan,
      text: opts.body,
      depth: opts.scan.depth + 1,
      isBody: true,
    });

    return {
      texts: ShellWordUtility.substitutionsIn({
        text: layout.text,
        from: 0,
        to: layout.text.length,
        layout,
      }),
      isUncertain: layout.isUncertain,
    };
  }

  /** Scans `opts.text`. */
  static scan(opts: IScanOptions): IShellLayout {
    const { text, depth } = opts;
    const layout: IShellLayout = {
      text: '',
      view: '',
      heredocs: [],
      heredocAt: new Map(),
      closes: new Map(),
      ariths: new Map(),
      isUncertain: false,
      unterminated: [],
    };
    const outer: IScanContext = {
      kind: opts.isBody ? ScanKinds.BODY : ScanKinds.COMMAND,
      at: 0,
      close: '',
      depth: 0,
      pending: [],
      commandStart: 0,
      program: { start: -1, name: '' },
      isOuter: true,
      isQuoted: false,
      cases: 0,
    };
    const stack: IScanContext[] = [outer];
    // `out` is the kept text the positions point into; `view` drops the data bodies inside substitutions too.
    let out = '';
    let view = '';
    let index = 0;
    // Where a word may start: after a blank or an operator of a command context, never right after an expansion.
    let breakAt = 0;

    const append = (piece: string): void => {
      out += piece;
      view += piece;
    };

    const copy = (length: number): void => {
      append(text.slice(index, index + length));
      index += length;
    };

    const open = (opener: { kind: TScanKind; close: string; length: number }): void => {
      const parent = stack[stack.length - 1] ?? outer;

      stack.push({
        kind: opener.kind,
        at: out.length,
        close: opener.close,
        depth: 0,
        pending: [],
        commandStart: out.length + opener.length,
        program: { start: -1, name: '' },
        isOuter: false,
        isQuoted: opener.kind === ScanKinds.DOUBLE || parent.isQuoted,
        cases: 0,
      });
      copy(opener.length);
      breakAt = index;
    };

    const pop = (): void => {
      const closed = stack.pop();

      // A heredoc opened inside a substitution that closes before its body starts.
      layout.isUncertain ||= (closed?.pending.length ?? 0) > 0;
    };

    // What cannot be followed is kept as it is, and flagged.
    const giveUp = (): void => {
      layout.isUncertain = true;
      append(text.slice(index));
      index = text.length;
    };

    const record = (entry: {
      pending: IPendingHeredoc;
      body: string;
      substitutions: string[];
    }): void => {
      const heredoc: IHeredoc = { body: entry.body, isInline: entry.pending.isInline };

      layout.heredocs.push(heredoc);
      layout.heredocAt.set(entry.pending.at, {
        heredoc,
        end: entry.pending.end,
        substitutions: entry.substitutions,
        isQuoted: entry.pending.isQuoted,
      });
    };

    // At a newline of `context`: the bodies of its heredocs, in order, each up to its delimiter line.
    const readBodies = (context: IScanContext): void => {
      for (const pending of context.pending) {
        const start = index;
        let bodyEnd = text.length;
        let next = text.length;
        let isFound = false;
        // In a body whose delimiter is not quoted, a backslash-newline joins two lines into one.
        let carry = '';

        while (index < text.length) {
          const newline = text.indexOf('\n', index);
          const lineEnd = newline === -1 ? text.length : newline;
          const line = carry + text.slice(index, lineEnd);
          const after = newline === -1 ? text.length : newline + 1;
          const isJoined =
            !pending.isQuoted && newline !== -1 && ShellScanUtility.endsEscaped({ line });

          // A joined line longer than the delimiter can never be it: a newline marks it, and costs nothing to carry.
          const isShort = line.length <= pending.delimiter.length + 1;

          carry = isJoined && isShort ? line.slice(0, -1) : '';
          carry = isJoined && !isShort ? '\n' : carry;

          // The delimiter line is the delimiter exactly; `<<-` strips leading tabs first.
          if (
            !isJoined &&
            (pending.stripTabs ? line.replace(/^\t+/, '') : line) === pending.delimiter
          ) {
            bodyEnd = Math.max(start, index - 1);
            next = after;
            isFound = true;
            break;
          }

          index = after;
        }

        const body = text.slice(start, bodyEnd);

        index = next;

        // Inside a substitution the body stays in the kept text: the substitution is read again on its own.
        if (!context.isOuter) {
          out += text.slice(start, next);
          view += pending.isInline ? text.slice(start, next) : '';
          continue;
        }

        if (pending.isInline) {
          if (depth + 1 > ShellConstants.MAX_DEPTH) {
            layout.isUncertain = true;
            append(body);
          } else {
            const script = ShellScanner.scan({ ...opts, text: body, depth: depth + 1 });

            ShellScanner.merge({ into: layout, from: script, shift: out.length });
            out += script.text;
            view += script.view;
          }

          append(isFound && body !== '' ? '\n' : '');
          record({ pending, body, substitutions: [] });
          continue;
        }

        const expanded = pending.isQuoted
          ? { texts: [], isUncertain: false }
          : ShellScanner.substitutionsOfBody({ body, scan: opts });

        layout.isUncertain ||= expanded.isUncertain;

        if (!isFound && body.trim() !== '') {
          layout.unterminated.push(body);
        }

        record({ pending, body, substitutions: expanded.texts });
      }

      context.pending = [];
    };

    while (index < text.length) {
      if (stack.length > ShellBudget.MAX_NESTING) {
        giveUp();
        break;
      }

      const context = stack[stack.length - 1] ?? outer;
      const { kind } = context;
      const char = text[index] ?? '';
      const next = text[index + 1] ?? '';
      const isCommand = kind === ScanKinds.COMMAND || kind === ScanKinds.BACKTICK;
      const isWordStart = index === breakAt;
      const takesSingle =
        isCommand ||
        kind === ScanKinds.ARITHMETIC ||
        (kind === ScanKinds.BRACE && !context.isQuoted);

      if (char === '\\') {
        // A backslash-newline is removed before words are read: a word that started before it still starts.
        const isJoin = next === '\n' && isWordStart;

        copy(2);
        breakAt = isJoin ? index : breakAt;
        continue;
      }

      if (char === "'" && takesSingle) {
        const close = text.indexOf("'", index + 1);

        if (close === -1) {
          giveUp();
          break;
        }

        copy(close + 1 - index);
        continue;
      }

      if (char === '$' && next === "'" && takesSingle) {
        let end = index + 2;

        while (end < text.length && text[end] !== "'") {
          end += text[end] === '\\' ? 2 : 1;
        }

        if (end >= text.length) {
          giveUp();
          break;
        }

        copy(end + 1 - index);
        continue;
      }

      if (char === '"' && kind === ScanKinds.DOUBLE) {
        copy(1);
        pop();
        continue;
      }

      if (char === '"' && kind !== ScanKinds.BODY) {
        open({ kind: ScanKinds.DOUBLE, close: '"', length: 1 });
        continue;
      }

      if (char === '$' && next === '"' && isCommand) {
        open({ kind: ScanKinds.DOUBLE, close: '"', length: 2 });
        continue;
      }

      if (char === '$' && next === '(' && text[index + 2] === '(') {
        open({ kind: ScanKinds.ARITHMETIC, close: '))', length: 3 });
        continue;
      }

      if (char === '$' && next === '(') {
        open({ kind: ScanKinds.COMMAND, close: ')', length: 2 });
        continue;
      }

      if (char === '$' && next === '[') {
        open({ kind: ScanKinds.ARITHMETIC, close: ']', length: 2 });
        continue;
      }

      if (char === '$' && next === '{') {
        open({ kind: ScanKinds.BRACE, close: '}', length: 2 });
        continue;
      }

      if (char === '`' && kind === ScanKinds.BACKTICK) {
        layout.closes.set(context.at, out.length);
        copy(1);
        pop();
        continue;
      }

      if (char === '`') {
        open({ kind: ScanKinds.BACKTICK, close: '`', length: 1 });
        continue;
      }

      if (kind === ScanKinds.ARITHMETIC) {
        const isBracket = context.close === ']';

        if (char === (isBracket ? '[' : '(')) {
          context.depth += 1;
          copy(1);
          continue;
        }

        if (char === (isBracket ? ']' : ')') && context.depth > 0) {
          context.depth -= 1;
          copy(1);
          continue;
        }

        if (char === ']' && isBracket) {
          layout.ariths.set(context.at, out.length);
          copy(1);
          pop();
          continue;
        }

        if (char === ')') {
          // `((` that does not end in `))` is not arithmetic: bash reads it again as subshells.
          if (next === ')') {
            layout.ariths.set(context.at, out.length + 1);
          } else {
            layout.isUncertain = true;
          }

          copy(next === ')' ? 2 : 1);
          pop();
          continue;
        }

        copy(1);
        continue;
      }

      if (kind === ScanKinds.BRACE) {
        if (char === '{') {
          context.depth += 1;
        } else if (char === '}' && context.depth > 0) {
          context.depth -= 1;
        } else if (char === '}') {
          copy(1);
          pop();
          continue;
        }

        copy(1);
        continue;
      }

      if (!isCommand) {
        copy(1);
        continue;
      }

      // A comment runs to the end of the line; it is dropped from the outermost text.
      if (char === '#' && isWordStart) {
        const newline = text.indexOf('\n', index);
        const end = newline === -1 ? text.length : newline;

        if (context.isOuter) {
          index = end;
        } else {
          copy(end - index);
        }

        continue;
      }

      if (char === '(' && next === '(' && isWordStart) {
        open({ kind: ScanKinds.ARITHMETIC, close: '))', length: 2 });
        continue;
      }

      // `case WORD in` opens patterns, each ended by a `)` that closes no substitution; `esac` ends them.
      if (isWordStart && !context.isOuter) {
        const reserved = ShellScanUtility.reservedAt({ text, index });

        context.cases += reserved === 'case' ? 1 : 0;
        context.cases -= reserved === 'esac' && context.cases > 0 ? 1 : 0;
      }

      if ((char === '<' || char === '>') && next === '(') {
        open({ kind: ScanKinds.COMMAND, close: ')', length: 2 });
        continue;
      }

      // The second `<` of an operator, past a backslash-newline between the two.
      const second = char === '<' ? ShellScanUtility.secondAngleAt({ text, index }) : -1;

      if (second !== -1 && text[second + 1] === '<') {
        copy(second + 2 - index);
        breakAt = index;
        continue;
      }

      if (second !== -1) {
        const operator = ShellScanUtility.operatorAt({ text, from: second - 1 });

        if (operator === undefined) {
          layout.isUncertain = true;
          copy(2);
          continue;
        }

        // The program is found once per command, however many heredocs it has.
        if (context.program.start !== context.commandStart) {
          context.program = {
            start: context.commandStart,
            name: opts.programBefore({ text: out, from: context.commandStart, layout }),
          };
        }

        const at = out.length;

        copy(operator.end - index);
        context.pending.push({
          ...operator,
          at,
          end: out.length,
          isInline: ShellPrograms.SHELL_SET.has(context.program.name),
        });
        continue;
      }

      if (char === '\n') {
        copy(1);
        context.commandStart = out.length;

        if (context.pending.length > 0) {
          readBodies(context);
          context.commandStart = out.length;
        }

        breakAt = index;
        continue;
      }

      // Inside a substitution: a subshell, the `)` of a case pattern, or the end of the substitution.
      const isNestedParen = !context.isOuter && (char === '(' || char === ')');
      const isOwnClose =
        char === ')' && context.close === ')' && context.depth === 0 && context.cases === 0;

      if (isNestedParen && !isOwnClose) {
        context.depth += char === '(' ? 1 : -Math.min(1, context.depth);
        copy(1);
        context.commandStart = out.length;
        breakAt = index;
        continue;
      }

      if (isOwnClose) {
        layout.closes.set(context.at, out.length);
        copy(1);
        pop();
        continue;
      }

      copy(1);

      if (';&|()'.includes(char)) {
        context.commandStart = out.length;
      }

      if (WORD_STARTS.has(char)) {
        breakAt = index;
      }
    }

    // A heredoc at the very end, with no newline after it, has an empty body.
    for (const pending of outer.pending) {
      record({ pending, body: '', substitutions: [] });
    }

    layout.isUncertain ||= stack.length > 1;
    layout.text = out;
    layout.view = view;

    return layout;
  }
}
