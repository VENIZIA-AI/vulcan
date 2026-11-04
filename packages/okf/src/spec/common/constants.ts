/** The OKF spec version this tooling reads and writes; a bundle that declares another is read best-effort. */
export class OkfVersions {
  static readonly V0_2 = '0.2';
  static readonly LATEST = this.V0_2;
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

/** How serious a conformance issue is: an `error` breaks OKF v0.2, a `warning` is soft guidance. */
export class IssueSeverities {
  static readonly ERROR = 'error';
  static readonly WARNING = 'warning';
  static readonly SCHEME_SET = new Set<string>([this.ERROR, this.WARNING]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The two file names OKF v0.2 reserves at the bundle root: `index.md` (the contents list) and `log.md` (the change log); neither is a concept. */
export class ReservedFiles {
  static readonly INDEX = 'index.md';
  static readonly LOG = 'log.md';
  static readonly SCHEME_SET = new Set<string>([this.INDEX, this.LOG]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** Fixed names of the spec: the root index file and the `okf_version` key of its front matter. */
export class SpecConstants {
  static readonly ROOT_INDEX = ReservedFiles.INDEX;
  static readonly VERSION_KEY = 'okf_version';
}
