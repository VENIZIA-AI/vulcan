import type { TConstValue } from '../../common/index.ts';
import type {
  GuardDecisions,
  LinkPassages,
  ProtectedModes,
  ShellModes,
  WriteRules,
} from './constants.ts';

export type TGuardDecision = TConstValue<typeof GuardDecisions>;
export type TWriteRule = TConstValue<typeof WriteRules>;
export type TLinkPassage = TConstValue<typeof LinkPassages>;

export interface IWriteCheck {
  rule: string;
  what: string;
  pattern: RegExp;
}

export interface IWriteHit {
  rule: string;
  message: string;
}

/** The part of a Claude Code PreToolUse payload the guard reads, mapped from its snake_case wire form. */
export interface IHookCommand {
  command: string;
  cwd: string | undefined;
  /** The session of the call, when the host sends one: it names the flow a session last opened. */
  sessionId?: string;
}

/** What a guard reads of any tool call: the tool, the file it names, or the Bash command. */
export interface IManifestHookInput {
  tool: string;
  filePath: string | undefined;
  command: string | undefined;
  cwd: string | undefined;
}

/** One thing a guard found: how to answer (`ask` or `deny`), the rule it enforces, and what the command does. */
export interface IGitHit {
  decision: TGuardDecision;
  rule: string;
  message: string;
  /**
   * What the agent does to get past a `deny` by itself (name the files, pass the base, write a literal path). A denial with
   * a `fix` is the agent's to repair and is never handed to a person; one without it needs the owner.
   */
  fix?: string;
}

/** Runs a read-only `git` or `gh` query for a guard; `undefined` when it cannot answer. */
export type IGitRunner = (opts: {
  program: string;
  args: string[];
  cwd: string | undefined;
}) => string | undefined;

/** A path a command would create or write outside the project, and what writes it. */
export interface IOutsideHit {
  path: string;
  message: string;
  /** Whether the path is under the scratchpad folder an agent tool offers: the hook denies it, it does not ask. */
  isAgentToolScratchpad: boolean;
  /** Whether the check could not read the line or the target, so it does not know that anything is outside: the hook asks, even where the project denies. */
  isUnread: boolean;
  /** Whether the path is what an `ln` of the line links to: a write through the link changes it, so the hook denies and says how to link a path inside. */
  isLink?: boolean;
  /** Whether the path is one of the files the guards read their policy from: the hook denies a write to it, whatever the project sets. */
  isProtected?: boolean;
}

/** One simple command of a shell line: its words, the files it redirects into, its leading `NAME=value` words. */
export interface ISimpleCommand {
  words: string[];
  redirects: string[];
  /** The `>&word` targets that hold an expansion (`>&$fd`): a descriptor or a file, the line does not say which. They are in `redirects` too. */
  copies?: string[];
  /** The bodies of the heredocs whose delimiter is not quoted: the shell expands them before the command reads them. */
  expandedBodies?: string[];
  assignments: string[];
  /** The body of the heredoc this command reads, when it is not read as commands itself (data, or a query or script for another program). */
  heredoc?: string;
  /** What the line feeds the command's standard input; absent when the line feeds it nothing. */
  input?: ICommandInput;
  /**
   * Where the command runs, when not at the top of the line: `/N` is the subshell `( ... )` numbered N and
   * `>N` the command line numbered N that a word carries (`$(...)`, `sh -c`), each segment inside the one before.
   */
  scope?: string;
  /** The command whose word carries this command's line (`$(...)`, `sh -c`): the line starts in its folder. */
  carrier?: ISimpleCommand;
  /**
   * The words (and redirect targets, and assignments as `NAME=value`) of this command that hold a `$` the line quoted or
   * escaped (`'$S'`, `\$S`): their text reads as a live `$S` but the shell takes the `$` as a character. A guard that
   * expands variables must not expand these.
   */
  literalDollars?: string[];
}

/** The standard input of a simple command, as far as the line shows it. */
export interface ICommandInput {
  /** The files a `<` reads. */
  files: string[];
  /** The command whose output a `|` feeds in. */
  pipedFrom?: ISimpleCommand;
  /** The text of each here-string (`<<< text`). */
  texts: string[];
  /** A heredoc feeds it: its body is on `heredoc`, or read as commands of the line when a shell reads it. */
  hasHeredoc: boolean;
}

export type TShellMode = TConstValue<typeof ShellModes>;

/** A shell call read past its own options: how it runs, and its first word that is not an option. */
export interface IShellCall {
  mode: TShellMode;
  /** The `-c` text, the script, or the first argument after `-s`; `undefined` when there is none. */
  word: string | undefined;
}

/** A heredoc of the outermost text, keyed by where its operator starts in the kept text. */
export interface IHeredocAt {
  heredoc: IHeredoc;
  /** Where the operator ends in the kept text. */
  end: number;
  /** The substitutions of a body whose delimiter is not quoted: bash runs them. */
  substitutions: string[];
  /** The delimiter is quoted: the body is data. */
  isQuoted: boolean;
}

/** What the scanner found in a text, every position an index of the kept text. */
export interface IShellLayout {
  /**
   * The text without comments and without the heredoc bodies of the outermost text that are data. A body inside
   * a substitution stays, for the substitution to be read again with it.
   */
  text: string;
  /** `text` without the data bodies inside substitutions too: what a reader of the whole line sees run. */
  view: string;
  heredocs: IHeredoc[];
  heredocAt: Map<number, IHeredocAt>;
  /** The index of the character that closes each `$(`, `<(`, `>(` and backtick, by the index of its opener. */
  closes: Map<number, number>;
  /** The index of the last character of each `$((...))`, `((...))` and `$[...]`, by the index of its opener. */
  ariths: Map<number, number>;
  /** Something could not be followed to its end: a quote, a substitution or a heredoc operator. */
  isUncertain: boolean;
  /** The bodies of heredocs whose delimiter never came, the end of the text ending them. */
  unterminated: string[];
}

export interface IHeredoc {
  body: string;
  /** The body was left in the text because a shell reads it as commands (`bash <<EOF`). */
  isInline: boolean;
}

export type TEnvironment = Record<string, string | undefined>;

export type TProtectedMode = TConstValue<typeof ProtectedModes>;

/** A path a command writes, and the folder it is taken from. */
export interface IWriteTarget {
  word: string;
  message: string;
  /** The directory a relative `word` is taken from: the hook's, moved by `cd` and `git -C`. */
  base: string;
  /** What `$PWD` is in `word`: the shell's folder, moved by `cd` but not by `git -C`; undefined when it is not known. */
  pwd?: string;
  /** The plain variables the same shell set earlier on the line. */
  vars?: Record<string, string>;
  /** False after a `cd` the guard could not work out: `base` is then only the last folder it knew. */
  isKnown?: boolean;
  /** `>&word` with an expansion in it: a file, or a descriptor held in a variable. */
  isAmbiguous?: boolean;
  /** The target of a shell redirect. */
  isRedirect?: boolean;
  /** The word has a brace the guard cannot expand into its branches, so where it writes is not known. */
  hasUnreadBrace?: boolean;
  /** What a hard link of the line (`ln`, `cp -l`) links to, not a file it writes: the same file, so outside the project is outside. */
  isLinkSource?: boolean;
  /** What `cp`, `mv`, `rsync`, `install` or `ln` reads: not a write, but a link made on the line would be copied or moved by it. */
  isLinkRead?: boolean;
  /** The name a link is made at (or the folder it is made in): it is the command's own, so it is not a path through an earlier link. */
  isLinkName?: boolean;
  /** The absolute names of the symbolic links the line made before this command. */
  links?: string[];
  /** The line made a symbolic link this check could not name, so any path after it may go through one. */
  hasUnknownLink?: boolean;
  /** A `$` of the word was quoted or escaped: it is a character, and the word's text reads it as a variable. */
  hasLiteralDollar?: boolean;
  /**
   * A removal or an in-place edit (`rm`, `sed -i`, `mv` of a source...): it creates nothing, so only a file the guards read
   * their policy from counts. Every other path of such a word is left to the owner.
   */
  isProtectedOnly?: boolean;
  /** Like `isProtectedOnly`, for one name put into a folder (`cp f dir` writes `dir/f`): only the file itself counts, not a folder above it. */
  isNameInFolder?: boolean;
  /** A folder that things are put into, or deleted from, under names this check cannot tell: it counts when it holds a file the guards read. */
  isIntoFolder?: boolean;
  /** The destination of a command that may replace it whole (`mv`, `rsync`, `ln`, a recursive `cp`): the folder `node_modules` counts, which a file write does not. */
  isPut?: boolean;
  /** An edit in place (`sed -i`, `perl -i`, `truncate`): a write like a redirect, and a pattern in it is judged by what it can reach. */
  isEdit?: boolean;
}

/** The options of a program that take a value, so the word after one is its value and no file of its own. */
export interface IOptionValues {
  /** Short options that take a value: `-t DIR`, `-tDIR`, `-vtDIR`. */
  shorts: string;
  /** Long options that take the next word as their value (`--suffix .bak`). */
  longs: readonly string[];
}

/** One row of the table: a program, with its aliases, and what it is called with that writes. */
export interface IWriteCommandRow {
  rule: TWriteRule;
  what: string;
  /** The names it is run by. None: the pattern stands alone (`db:migrate` in any command). */
  programs: readonly string[];
  /**
   * The verbs that write, each a run of words split by blanks, a word being alternatives (`state rm`,
   * `up|down`). They come first after the program's options, or anywhere in it when `isAnywhere`.
   */
  verbs?: readonly string[];
  /** Verbs that start like a write and only read (`rollout status`). */
  reads?: readonly string[];
  isAnywhere?: boolean;
  /** A shape the verbs cannot say, as regular expression source after the program. */
  pattern?: string;
  /** A word that makes a call of the program change nothing (`--help`, `--dry-run`, `--check`). */
  inert?: string;
  ignoreCase?: boolean;
}

export interface IBudget {
  commands: number;
  words: number;
  chars: number;
  /** The subshells and nested command lines numbered so far, so each scope is unique in the line. */
  scopes: number;
  /** Something was not read: the budget ran out, or a command nests deeper than the depth limit. */
  isOver: boolean;
  /** Something could not be followed to its end. */
  isUncertain: boolean;
  /** A command's program is a variable or a substitution. */
  hasUnknownProgram: boolean;
  /** The commands of heredoc bodies whose delimiter never came. */
  unterminated: ISimpleCommand[];
}

export interface IParsedShell {
  commands: ISimpleCommand[];
  /** Part of the line was not read: it is larger, or nests deeper, than the parser's budget. */
  isOverBudget: boolean;
  /** Part of the line could not be followed to its end: a quote, a substitution or a heredoc operator. */
  isUncertain: boolean;
  /** A command runs a program the line does not show (`$cmd`, `"$@"`, `$(tool)`): a guard cannot tell what it is. */
  hasUnknownProgram: boolean;
  /** The lines of a heredoc body whose delimiter never came, read as commands: data to bash, a second view to a guard. */
  unterminatedHeredocCommands: ISimpleCommand[];
}
