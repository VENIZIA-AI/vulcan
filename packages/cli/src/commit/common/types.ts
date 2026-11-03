import type { TConstValue } from '../../common/index.ts';
import type { AgentSignaturePolicies, CommitHookStates } from './constants.ts';

export type TAgentSignaturePolicy = TConstValue<typeof AgentSignaturePolicies>;

export interface ICommitAgents {
  /** Names that begin a co-author's name when an agent made the commit: "Claude Code", "Cursor Agent". */
  products: string[];
  /** Words a "generated with" line names an agent by: "Claude", "Gemini". */
  mentions: string[];
  /** Local parts that name an agent: `cursoragent`, on an address at one of `addressDomains`. */
  addressNames: string[];
  addressDomains: string[];
  noreplyDomains: string[];
  generatedPhrases: string[];
  /** Names the project says are never an agent (a person called Claude). */
  allow: string[];
}

/** `line` counts from 1. */
export interface ISignatureHit {
  line: number;
  text: string;
}

/** `pattern` is a regular expression source. */
export interface ICommitSubject {
  pattern: string;
  hint?: string;
}

export interface ISubjectProblem {
  line: number;
  text: string;
  hint: string | undefined;
}

export interface ICommitPolicy {
  agentSignature: TAgentSignaturePolicy;
  agents: ICommitAgents;
  subject?: ICommitSubject;
}

export type TCommitHookState = TConstValue<typeof CommitHookStates>;

export interface ICommitHookStatus {
  state: TCommitHookState;
  /** Empty when the folder is not a git repository. */
  path: string;
  /** What the developer does when sync cannot: the line to add to a hook that is theirs. */
  note?: string;
}

/** The prefixes git treats as comment lines, and as the start of the scissors line. */
export interface ICommentStyle {
  prefixes: string[];
}
