export class AppSides {
  static readonly BACKEND = 'backend';
  static readonly FRONTEND = 'frontend';
  static readonly SCHEME_SET = new Set<string>([this.BACKEND, this.FRONTEND]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class CreateConstants {
  static readonly NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
  /** A plain version with an optional prerelease and build part; ranges and URLs are not one. */
  static readonly VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
  static readonly PRERELEASE_PATTERN = /^\d+\.\d+\.\d+-/;
  static readonly PRESET_FIELD = 'vulcan';
  static readonly PRESET_VERSION = 1;
  /** A preset named without a scope is a package in the framework scope. */
  static readonly PRESET_SCOPE = '@venizia/';
  static readonly PRESET_FILE_PREFIX = 'file:';
  /**
   * npm drops these dotfiles from a tarball, so a preset ships them under the `_` name. The list is
   * explicit: a blanket `_` rule would rename `__root.tsx`, `_app.tsx` and `_redirects`.
   */
  static readonly PRESET_DOTFILE_NAMES: readonly string[] = [
    '_gitignore',
    '_npmrc',
    '_env',
    '_env.example',
  ];
  static readonly STDIN_DESCRIPTOR = 0;
  /** Tests only: set to `1`, every install, git and check command is printed as skipped instead of run. */
  static readonly NO_INSTALL_ENV = 'VULCAN_NO_INSTALL';
  /** Tests only: a path that stands in for the `bun` executable, so a test fakes success or failure. */
  static readonly BUN_ENV = 'VULCAN_BUN';
  /** Tests only: a path that stands in for the `git` executable. */
  static readonly GIT_ENV = 'VULCAN_GIT';
  static readonly APPS_BLOCK_START =
    '// vulcan:apps:start - written by vulcan init and add; edit outside this block';
  static readonly APPS_BLOCK_END = '// vulcan:apps:end';
}

export class CreateFlags {
  static readonly PRESET = '--preset';
  static readonly PROJECT = '--project';
  static readonly BACKEND_DIR = '--backend-dir';
  static readonly FRONTEND_DIR = '--frontend-dir';
  static readonly SHARED_DIR = '--shared-dir';
  static readonly APP = '--app';
  static readonly API = '--api';
  static readonly NO_API = '--no-api';
  static readonly LIB = '--lib';
  static readonly DIR = '--dir';
  static readonly SCOPE = '--scope';
  static readonly FULL = '--full';
  static readonly CHECK = '--check';
}

/** One line of a line diff: kept, only in the preset (added) or only in the app (removed). */
export class DiffEditKinds {
  static readonly KEEP = 'keep';
  static readonly ADD = 'add';
  static readonly REMOVE = 'remove';
  static readonly SCHEME_SET = new Set<string>([this.KEEP, this.ADD, this.REMOVE]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** What `preset diff` says of a file the preset makes, next to the file the app has. */
export class PresetDiffStatuses {
  static readonly SAME = 'same';
  static readonly DIFFERS = 'differs';
  static readonly MISSING = 'missing';
  static readonly SCHEME_SET = new Set<string>([this.SAME, this.DIFFERS, this.MISSING]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}
