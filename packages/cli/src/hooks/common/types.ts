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
}

/** What the manifest guard reads of any tool call: the tool, the file it names, or the Bash command. */
export interface IManifestHookInput {
  tool: string;
  filePath: string | undefined;
  command: string | undefined;
  cwd: string | undefined;
}
