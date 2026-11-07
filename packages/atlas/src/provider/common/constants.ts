/** The git hosts the provider layer has a provider for. */
export class ProviderTypes {
  static readonly GITHUB = 'github';

  static readonly SCHEME_SET = new Set<string>([this.GITHUB]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The host each type has when a project names none. */
export class ProviderHosts {
  static readonly GITHUB = 'github.com';
}

/** Why a provider could not answer. `unreachable` is never `not-found`: atlas serves its cache for one and fails for the other. */
export class ProviderReasons {
  static readonly UNAUTHENTICATED = 'unauthenticated';
  static readonly NOT_FOUND = 'not-found';
  static readonly RATE_LIMITED = 'rate-limited';
  static readonly UNREACHABLE = 'unreachable';
  static readonly UNSUPPORTED = 'unsupported';
  static readonly INVALID_REPLY = 'invalid-reply';

  static readonly SCHEME_SET = new Set<string>([
    this.UNAUTHENTICATED,
    this.NOT_FOUND,
    this.RATE_LIMITED,
    this.UNREACHABLE,
    this.UNSUPPORTED,
    this.INVALID_REPLY,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The states a change request (pull request or merge request) is in. */
export class ChangeRequestStates {
  static readonly OPEN = 'open';
  static readonly MERGED = 'merged';
  static readonly CLOSED = 'closed';
}

/** How one check of a change request ended. */
export class CheckStates {
  static readonly PASSED = 'passed';
  static readonly FAILED = 'failed';
  static readonly PENDING = 'pending';
}

/** What a reviewer decided. */
export class ReviewStates {
  static readonly APPROVED = 'approved';
  static readonly CHANGES_REQUESTED = 'changes-requested';
  static readonly COMMENTED = 'commented';
}
