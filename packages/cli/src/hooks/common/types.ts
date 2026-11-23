import type { TConstValue } from '../../common/index.ts';
import type { GuardDecisions } from './constants.ts';

export type TGuardDecision = TConstValue<typeof GuardDecisions>;

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
