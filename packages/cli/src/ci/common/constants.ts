export class CiSubcommands {
  static readonly AFFECTED = 'affected';
  static readonly TEMPLATE = 'template';
}

export class CiFlags {
  static readonly BASE = '--base';
  static readonly HEAD = '--head';
  static readonly CHECK = '--check';
  static readonly JSON = '--json';
  static readonly NAMES = '--names';
}

/** The checks a package can have: each is the name of a `package.json` script, the standard names of an app. */
export class CiChecks {
  static readonly TYPECHECK = 'typecheck';
  static readonly LINT = 'lint';
  static readonly TEST = 'test';
  static readonly COMPILE = 'compile';

  static readonly SCHEME_SET = new Set<string>([
    this.TYPECHECK,
    this.LINT,
    this.TEST,
    this.COMPILE,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** Why a package is on the list. */
export class AffectedReasons {
  /** One of its files changed. */
  static readonly CHANGED = 'changed';
  /** It uses a `catalog:` entry whose version changed in the root `package.json`. */
  static readonly CATALOG = 'catalog';
  /** A package it depends on is affected. */
  static readonly DEPENDENT = 'dependent';
  /** A file every package depends on changed, so all are on the list. */
  static readonly GLOBAL = 'global';
}

/** The CI systems that have a template. */
export class CiTemplates {
  static readonly GITHUB = 'github';
  static readonly GITLAB = 'gitlab';

  static readonly FILES: Record<string, string> = {
    [this.GITHUB]: 'github-actions.yml',
    [this.GITLAB]: 'gitlab-ci.yml',
  };

  static readonly SCHEME_SET = new Set<string>([this.GITHUB, this.GITLAB]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class CiConstants {
  static readonly ROOT_MANIFEST = 'package.json';
  static readonly MANIFEST_FILE = '.agents/vulcan.manifest.json';
  /** The shipped list of files every package depends on, in the package's `base/`. */
  static readonly GLOBAL_FILE = 'ci-global.json';
  static readonly TEMPLATE_FOLDER = 'templates/ci';
  /** What a CI system passes as the base of a push that has no parent: nothing to compare with. */
  static readonly EMPTY_BASE = /^0{40}(?:0{24})?$/;
  static readonly DEPENDENCY_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];
  /** The root keys that hold catalogs, at the top and inside `workspaces`. */
  static readonly CATALOG_KEYS = ['catalog', 'catalogs'];
  static readonly DEFAULT_CATALOG = 'default';
  static readonly CATALOG_PREFIX = 'catalog:';
  static readonly GIT_TIMEOUT_MS = 30_000;
  static readonly GIT_MAX_BUFFER = 256 * 1024 * 1024;
}
