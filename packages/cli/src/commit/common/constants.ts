export class AgentSignaturePolicies {
  static readonly ALLOW = 'allow';
  static readonly DENY = 'deny';

  static readonly SCHEME_SET = new Set<string>([this.ALLOW, this.DENY]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class CommitCheckFlags {
  static readonly RANGE = '--range';
  static readonly TEXT = '--text';
}

export class CommitHookStates {
  static readonly OFF = 'off';
  static readonly NOT_GIT = 'not-git';
  static readonly MISSING = 'missing';
  /** The hook calls `vulcan commit-check`: ours and current, or the developer's own wiring. */
  static readonly WIRED = 'wired';
  static readonly STALE = 'stale';
  /** A hook that is not ours and does not call the check: the developer adds the line. */
  static readonly UNWIRED = 'unwired';
  /** A hook that another project of the repository wrote: this project's check is not installed, and the hook is not touched. */
  static readonly OTHER_PROJECT = 'other-project';
  /** Our hook, and the project turned every check off: sync takes it back. */
  static readonly LEFTOVER = 'leftover';
}
