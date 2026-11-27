import { EnvVariables } from '../../common/env-variables.ts';
import { ConstClass } from '../../common/types.ts';
import { LibraryTypes, PackageTypes } from '../../config/common/index.ts';
import type { TAddKind } from './types.ts';

export class AppSides extends ConstClass {
  static readonly BACKEND = 'backend';
  static readonly FRONTEND = 'frontend';
}

/** Why the `vulcan:apps` block of the config could not be read: its markers are gone, or what is between them is not JSON. */
export class AppsBlockProblems {
  static readonly MISSING = 'missing';
  static readonly INVALID = 'invalid';
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
  static readonly NO_INSTALL_ENV = EnvVariables.VULCAN_NO_INSTALL;
  /** Tests only: a path that stands in for the `bun` executable, so a test fakes success or failure. */
  static readonly BUN_ENV = EnvVariables.VULCAN_BUN;
  /** Tests only: a path that stands in for the `git` executable. */
  static readonly GIT_ENV = EnvVariables.VULCAN_GIT;
  static readonly APPS_BLOCK_START =
    '// vulcan:apps:start - written by vulcan project init and add; edit outside this block';

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
  static readonly SHARED = '--shared';
  static readonly DIR = '--dir';
  static readonly SCOPE = '--scope';
  static readonly KEY = '--key';
  static readonly FULL = '--full';
  static readonly CHECK = '--check';
}

/** One line of a line diff: kept, only in the preset (added) or only in the app (removed). */
export class DiffEditKinds {
  static readonly KEEP = 'keep';
  static readonly ADD = 'add';
  static readonly REMOVE = 'remove';
}

/** What `preset diff` says of a file the preset makes, next to the file the app has. */
export class PresetDiffStatuses {
  static readonly SAME = 'same';
  static readonly DIFFERS = 'differs';
  static readonly MISSING = 'missing';
}

/** Texts of `add` that more than one of its files says. */
export class AddConstants {
  static readonly MISSING_API = `missing ${CreateFlags.API} <app> or ${CreateFlags.NO_API}`;
}

/** What `add` can make: per kind its flag and words, the order a menu lists them in, and the sentence that asks for one. */
export class AddKinds {
  /** Per kind: the flag that names it and the words a menu and a message describe it with. */
  static readonly TABLE: Record<TAddKind, { flag: string; hint: string }> = {
    [PackageTypes.APP]: { flag: CreateFlags.APP, hint: 'a runnable app' },
    [LibraryTypes.LIB]: { flag: CreateFlags.LIB, hint: 'a library other apps import' },
    [LibraryTypes.SHARED]: {
      flag: CreateFlags.SHARED,
      hint: 'a side-neutral package other apps import',
    },
  };

  static readonly ORDER: TAddKind[] = [PackageTypes.APP, LibraryTypes.LIB, LibraryTypes.SHARED];

  private static readonly DESCRIBED = this.ORDER.map(
    (kind) => `\`${this.TABLE[kind].flag} <name>\` (${this.TABLE[kind].hint})`,
  );

  static readonly SAY_WHAT = `say what to create - ${this.DESCRIBED.slice(0, -1).join(', ')} or ${this.DESCRIBED.at(-1)}`;
}
