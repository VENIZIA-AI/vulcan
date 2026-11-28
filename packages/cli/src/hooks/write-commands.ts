import type { TConstValue } from '../common/types.ts';
import type { ISimpleCommand, IWriteCheck, IWriteCommandRow, IWriteHit } from './common/index.ts';
import { SqlUnseen, WritePatterns } from './common/index.ts';
import { ShellPrograms } from './shell-programs.ts';
import { WriteCommandRows } from './write-command-rows.ts';

/** The options a program takes before its verb (`kubectl -n prod apply`), each with or without a value. */
const OPTIONS = String.raw`(?:\s+-\S+(?:\s+[^\s-]\S*)?)*`;

/** A program name starts a word: `ssh` is not `sh`, `deploy.sh` is not `sh`. */
const PROGRAM_START = String.raw`(?:^|[^\w.-])`;

/** Where a database client takes what it runs. */
class SqlClientModes {
  /** An option carries the SQL (`psql -c`, `mysql -e`). */
  static readonly INLINE = 'inline';
  /** The words after the database file are SQL, and dot-commands (`sqlite3`). */
  static readonly SQLITE = 'sqlite';
  /** `--eval`, `--file` or a `.js` file (`mongosh`). */
  static readonly MONGO = 'mongo';
}

type TSqlClientMode = TConstValue<typeof SqlClientModes>;

interface ISqlClient {
  mode: TSqlClientMode;
  /** The option that carries code on the line; the group is a value attached to it. */
  inline: RegExp;
}

/** A row ready to match: its pattern, and what makes a call of its programs change nothing. */
export interface ICommandCheck extends IWriteCheck {
  programs: ReadonlySet<string>;
  inert: RegExp | undefined;
}

/** The rows of `WriteCommandRows`, compiled, and what a database client is given that the line does not show. */
export class WriteCommands {
  /**
   * Database clients and where they take what they run. `inline` is the option that carries SQL on the line,
   * its value attached or the next word; with none (and no heredoc) a client reads SQL from its input.
   * `sqlite3` takes SQL as the words after the database file; `mongosh` takes `--eval`, `--file` or a file.
   */
  static readonly SQL_CLIENTS: Readonly<Record<string, ISqlClient>> = {
    psql: {
      mode: SqlClientModes.INLINE,
      inline: /^(?:-[aAbeEHlnqsStwWxX0-9z]*c|--command(?:=|$))([\s\S]*)$/,
    },
    mysql: {
      mode: SqlClientModes.INLINE,
      inline: /^(?:-[BNnqrstvX]*e|--execute(?:=|$))([\s\S]*)$/,
    },
    mariadb: {
      mode: SqlClientModes.INLINE,
      inline: /^(?:-[BNnqrstvX]*e|--execute(?:=|$))([\s\S]*)$/,
    },
    sqlite3: { mode: SqlClientModes.SQLITE, inline: /^--?cmd(?:=|$)([\s\S]*)$/ },
    mongosh: { mode: SqlClientModes.MONGO, inline: /^--eval(?:=|$)([\s\S]*)$/ },
    mongo: { mode: SqlClientModes.MONGO, inline: /^--eval(?:=|$)([\s\S]*)$/ },
  };

  /** The options that make a database client only print something and read nothing. */
  static readonly SQL_CLIENT_INFO = new Set([
    '-l',
    '--list',
    '-V',
    '--version',
    '-version',
    '--help',
    '-help',
    '-?',
  ]);

  /** The `sqlite3` options that take the next word. */
  static readonly SQLITE_VALUES = new Set([
    '-cmd',
    '-init',
    '-separator',
    '-newline',
    '-nullvalue',
    '-vfs',
    '-mmap',
    '-pagecache',
    '-lookaside',
    '-heap',
    '-maxsize',
  ]);

  /** The `rg` options that name a program to run; the group is a value attached to them. */
  static readonly RG_RUNS = /^--(?:pre|hostname-bin)(?:=([\s\S]*))?$/;

  /** A client command that runs a SQL file: psql's `\i`, mysql's `source` and `\.`, sqlite3's `.read`. */
  static readonly SQL_FILE_COMMAND =
    /(?:^|;)\s*(?:\\(?:i|ir|include|include_relative|\.)\s|source\s|\.(?:read|import|restore)\s)/im;

  /** The rows, compiled. */
  static readonly CHECKS: readonly ICommandCheck[] = WriteCommandRows.ROWS.map((row) =>
    WriteCommands.compile({ row }),
  );

  /** A run of words, each a set of alternatives, with the program's options allowed between them. */
  private static wordsOf(opts: { verb: string }): string {
    return opts.verb
      .split(' ')
      .map((word) => `(?:${word})`)
      .join(`${OPTIONS}\\s+`);
  }

  private static compile(opts: { row: IWriteCommandRow }): ICommandCheck {
    const { row } = opts;
    const names = row.programs.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    // A program name is exact (`HTTP` in TypeScript is no `http`): `ignoreCase` covers the words after it.
    const head = names.length === 0 ? '' : `${PROGRAM_START}(?-i:${names.join('|')})`;
    const verbs = (row.verbs ?? []).map((verb) => WriteCommands.wordsOf({ verb })).join('|');
    const reads = (row.reads ?? []).map((verb) => WriteCommands.wordsOf({ verb })).join('|');
    const notRead = reads === '' ? '' : `(?!(?:${reads})${WritePatterns.VERB_END})`;
    const body = WriteCommands.bodyOf({ row, verbs, notRead });

    return {
      rule: row.rule,
      what: row.what,
      pattern: new RegExp(`${head}${body}`, row.ignoreCase === true ? 'i' : ''),
      programs: new Set(row.programs.map((name) => ShellPrograms.basenameOf({ word: name }))),
      inert: row.inert === undefined ? undefined : new RegExp(row.inert),
    };
  }

  /** What follows the program: its own pattern, its verbs (first, or anywhere), or nothing (any call writes). */
  private static bodyOf(opts: { row: IWriteCommandRow; verbs: string; notRead: string }): string {
    const { row, verbs, notRead } = opts;

    // The name ends where the pattern starts: `ansible` is not `ansible-playbook`.
    if (row.pattern !== undefined) {
      return row.programs.length === 0
        ? row.pattern
        : `${WritePatterns.VERB_END}(?:${row.pattern})`;
    }

    if (verbs === '') {
      return WritePatterns.VERB_END;
    }

    if (row.isAnywhere === true) {
      return `${WritePatterns.VERB_END}${WritePatterns.REST}\\s${notRead}(?:${verbs})${WritePatterns.VERB_END}`;
    }

    return `${OPTIONS}\\s+${notRead}(?:${verbs})${WritePatterns.VERB_END}`;
  }

  /**
   * Whether a check applies to a call of `program` with `args`: not when the program is one of the check's
   * own and a word makes the call change nothing (`kubectl apply --dry-run=client`). A word right after an
   * option is no inert word: it may be the option's value (`kubectl apply -f x --field-manager --dry-run=client`
   * applies), and no table of which options take a value is complete. An inert word whose option is named more
   * than once on the line is not read either: the last value wins.
   */
  static isLive(opts: { check: ICommandCheck; program: string; args: readonly string[] }): boolean {
    const { inert } = opts.check;

    if (inert === undefined || !opts.check.programs.has(opts.program)) {
      return true;
    }

    // The last value of an option wins: `--dry-run --dry-run=none` runs for real. An option named twice is not read.
    const nameOf = (word: string): string => word.split('=')[0] ?? word;

    return !opts.args.some((word, index) => {
      const previous = opts.args[index - 1] ?? '';

      return (
        inert.test(word) &&
        !(previous.startsWith('-') && !previous.includes('=')) &&
        !opts.args.some((other, at) => at !== index && nameOf(other) === nameOf(word))
      );
    });
  }

  /**
   * What a database client runs that the line does not show: SQL from its input (a pipe, a `<` file, the
   * terminal), a file it is told to run, or SQL built when the command runs (`psql -c "$SQL"`).
   */
  static inspectClient(opts: { command: ISimpleCommand }): IWriteHit[] {
    const { name, args } = ShellPrograms.programOf({ command: opts.command });
    const program = ShellPrograms.basenameOf({ word: name });
    const client = Object.hasOwn(WriteCommands.SQL_CLIENTS, program)
      ? WriteCommands.SQL_CLIENTS[program]
      : undefined;

    if (client === undefined || args.some((word) => WriteCommands.SQL_CLIENT_INFO.has(word))) {
      return [];
    }

    const values = WriteCommands.valuesOf({ args, option: client.inline });
    const hasHeredoc = opts.command.heredoc !== undefined;

    switch (client.mode) {
      case SqlClientModes.SQLITE: {
        return WriteCommands.sqliteHitsOf({
          args: WriteCommands.withoutInput({ args, command: opts.command }),
          values,
          hasHeredoc,
        });
      }
      case SqlClientModes.MONGO: {
        const hasFile = args.some(
          (word, index) =>
            /^(?:--file(?:=|$)|-f$)/.test(word) ||
            (/\.(?:js|mongodb)$/.test(word) && !WriteCommands.isValueAt({ args, index, client })),
        );

        if (hasFile) {
          return [WriteCommands.hitOf({ message: SqlUnseen.FILE })];
        }

        return values.length === 0 && !hasHeredoc
          ? [WriteCommands.hitOf({ message: SqlUnseen.INPUT })]
          : [];
      }
      default: {
        if (values.length === 0) {
          return hasHeredoc ? [] : [WriteCommands.hitOf({ message: SqlUnseen.INPUT })];
        }

        return WriteCommands.valueHitsOf({ values });
      }
    }
  }

  /** The words of a command without the files of its `<` redirects, which the shell puts among them. */
  private static withoutInput(opts: {
    args: readonly string[];
    command: ISimpleCommand;
  }): string[] {
    const files = [...(opts.command.input?.files ?? [])];

    return opts.args.filter((word) => {
      const at = files.indexOf(word);

      if (at === -1) {
        return true;
      }

      files.splice(at, 1);

      return false;
    });
  }

  /** `sqlite3 [options] FILE [SQL...]`: no SQL reads the input; `-init` and `.read` run a file. */
  private static sqliteHitsOf(opts: {
    args: readonly string[];
    values: string[];
    hasHeredoc: boolean;
  }): IWriteHit[] {
    const { args } = opts;
    const positional: string[] = [];
    let hasInit = false;

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? '';
      const option = word.startsWith('--') ? word.slice(1) : word;

      if (!word.startsWith('-')) {
        positional.push(word);
        continue;
      }

      hasInit ||= option === '-init';
      index += WriteCommands.SQLITE_VALUES.has(option) ? 1 : 0;
    }

    if (hasInit) {
      return [WriteCommands.hitOf({ message: SqlUnseen.FILE })];
    }

    const sql = [...positional.slice(1), ...opts.values];

    if (sql.length === 0) {
      return opts.hasHeredoc ? [] : [WriteCommands.hitOf({ message: SqlUnseen.INPUT })];
    }

    return WriteCommands.valueHitsOf({ values: sql });
  }

  /** SQL on the line that runs a file, or that the shell builds when the command runs. */
  private static valueHitsOf(opts: { values: readonly string[] }): IWriteHit[] {
    const hits: IWriteHit[] = [];

    if (opts.values.some((value) => /[$`]/.test(value))) {
      hits.push(WriteCommands.hitOf({ message: SqlUnseen.BUILT }));
    }

    if (opts.values.some((value) => WriteCommands.SQL_FILE_COMMAND.test(value))) {
      hits.push(WriteCommands.hitOf({ message: SqlUnseen.FILE }));
    }

    return hits;
  }

  /** The values of `option` among `args`: attached to it, or the next word. */
  private static valuesOf(opts: { args: readonly string[]; option: RegExp }): string[] {
    const values: string[] = [];

    opts.args.forEach((word, index) => {
      const match = opts.option.exec(word);

      if (match === null) {
        return;
      }

      const attached = match[1] ?? '';
      const next = opts.args[index + 1];

      if (attached !== '') {
        values.push(attached);

        return;
      }

      if (next !== undefined) {
        values.push(next);
      }
    });

    return values;
  }

  /** Whether the word at `index` is the value of the client's inline option. */
  private static isValueAt(opts: {
    args: readonly string[];
    index: number;
    client: ISqlClient;
  }): boolean {
    const previous = opts.args[opts.index - 1];

    return previous !== undefined && opts.client.inline.exec(previous)?.[1] === '';
  }

  /**
   * A program of the table that is given its words from elsewhere, which no pattern can read: from the input of `xargs`,
   * or as the program `rg` runs on each file (`--pre`) or for its links (`--hostname-bin`).
   */
  static inspectFed(opts: { command: ISimpleCommand }): IWriteHit[] {
    const { name, args } = ShellPrograms.programOf({ command: opts.command });
    const program = ShellPrograms.basenameOf({ word: name });
    const byXargs = opts.command.words.includes('xargs') ? [program] : [];
    const byRg =
      program === 'rg' ? WriteCommands.valuesOf({ args, option: WriteCommands.RG_RUNS }) : [];

    return [
      ...byXargs.flatMap((fed) => WriteCommands.fedHitsOf({ program: fed, by: 'xargs' })),
      ...byRg.flatMap((fed) =>
        WriteCommands.fedHitsOf({ program: ShellPrograms.basenameOf({ word: fed }), by: 'rg' }),
      ),
    ];
  }

  private static fedHitsOf(opts: { program: string; by: string }): IWriteHit[] {
    const { program, by } = opts;
    const check = WriteCommands.CHECKS.find((row) => row.programs.has(program));
    const message = `\`${by}\` gives ${program} its command, which the line does not show`;

    if (check !== undefined) {
      return [{ rule: check.rule, message: `${check.what}: ${message}` }];
    }

    // A database client is no row of the table: it is judged by what it is given.
    return Object.hasOwn(WriteCommands.SQL_CLIENTS, program)
      ? [WriteCommands.hitOf({ message })]
      : [];
  }

  private static hitOf(opts: { message: string }): IWriteHit {
    return { rule: 'V-W-02', message: opts.message };
  }
}
