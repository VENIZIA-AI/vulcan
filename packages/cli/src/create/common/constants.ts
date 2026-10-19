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
}
