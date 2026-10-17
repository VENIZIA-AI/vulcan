/** OKF spec versions this tooling knows, newest last. */
export class OkfVersions {
  static readonly V0_1 = '0.1';
  static readonly V0_2 = '0.2';
  static readonly LATEST = this.V0_2;
  static readonly SCHEME_SET = new Set<string>([this.V0_1, this.V0_2]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** §5.4 - an absent status means stable. */
export class ConceptStatuses {
  static readonly DRAFT = 'draft';
  static readonly STABLE = 'stable';
  static readonly DEPRECATED = 'deprecated';
  static readonly SCHEME_SET = new Set<string>([this.DRAFT, this.STABLE, this.DEPRECATED]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class IssueSeverities {
  static readonly ERROR = 'error';
  static readonly WARNING = 'warning';
  static readonly SCHEME_SET = new Set<string>([this.ERROR, this.WARNING]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class ReservedFiles {
  static readonly INDEX = 'index.md';
  static readonly LOG = 'log.md';
  static readonly SCHEME_SET = new Set<string>([this.INDEX, this.LOG]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class SpecConstants {
  static readonly ROOT_INDEX = ReservedFiles.INDEX;
  static readonly VERSION_KEY = 'okf_version';
}
