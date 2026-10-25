import type { TConstValue } from '../../common/index.ts';
import type { GuardDecisions, PackageVerdictKinds } from './constants.ts';

export type TGuardDecision = TConstValue<typeof GuardDecisions>;
export type TPackageVerdictKind = TConstValue<typeof PackageVerdictKinds>;

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
}

/** What the manifest guard reads of any tool call: the tool, the file it names, or the Bash command. */
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
}
