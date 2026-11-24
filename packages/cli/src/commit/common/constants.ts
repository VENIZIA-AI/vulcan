import { ConstClass } from '../../common/types.ts';

export class AgentSignaturePolicies extends ConstClass {
  static readonly ALLOW = 'allow';
  static readonly DENY = 'deny';
}

export class CommitCheckFlags {
  static readonly RANGE = '--range';
  static readonly TEXT = '--text';
}

export class CommitHookStates {
  static readonly OFF = 'off';
  static readonly NOT_GIT = 'not-git';
  static readonly MISSING = 'missing';
  /** The hook calls `vulcan check commit`: ours and current, or the developer's own wiring. */
  static readonly WIRED = 'wired';
  static readonly STALE = 'stale';
  /** A hook that is not ours and does not call the check: the developer adds the line. */
  static readonly UNWIRED = 'unwired';
  /** A hook of the developer's that still runs `vulcan` by name through bunx or `bun x`: stale, and not ours to rewrite. */
  static readonly LEGACY = 'legacy';
  /** A hook that another project of the repository wrote: this project's check is not installed, and the hook is not touched. */
  static readonly OTHER_PROJECT = 'other-project';
  /** Our hook, and the project turned every check off: sync takes it back. */
  static readonly LEFTOVER = 'leftover';
}
