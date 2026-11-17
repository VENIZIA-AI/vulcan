import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RpcError, RpcErrorCodes } from '@/protocol/common';
import { InstalledPackages } from '@/sources/installed';

const SCOPE_PREFIX = '@venizia/';

// An exact version, not a range: `^0.2.0-11` and `>=1` name a set of versions, `0.2.0-11` names one.
export const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface IManifest {
  version?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /** A workspace root pins its dependency graph here rather than depending on it. */
  overrides?: Record<string, string>;
  /** Yarn spells the same thing this way. */
  resolutions?: Record<string, string>;
}

/** `undefined` when the file is absent; a file that exists but does not parse is named, never skipped. */
const readManifest = (opts: { file: string }): IManifest | undefined => {
  if (!existsSync(opts.file)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(opts.file, 'utf8'));
  } catch {
    throw new RpcError({
      code: RpcErrorCodes.INVALID_PARAMS,
      message: `unreadable package.json: ${opts.file}`,
    });
  }
};

interface IDeclared {
  name: string;
  spec: string;
  /** A dependency of the manifest itself, not only a pin of somebody else's. */
  isDirect: boolean;
}

/**
 * Every `@venizia/*` version the manifest declares, sorted. A workspace root often declares none
 * and pins every package under `overrides` (or yarn's `resolutions`) instead; reading only
 * dependencies answers "nothing installed" for exactly the repository that pins the most.
 */
const declaredOf = (opts: { manifest?: IManifest }): IDeclared[] => {
  const direct = {
    ...(opts.manifest?.dependencies ?? {}),
    ...(opts.manifest?.devDependencies ?? {}),
  };
  const declared = {
    ...direct,
    ...(opts.manifest?.resolutions ?? {}),
    ...(opts.manifest?.overrides ?? {}),
  };

  return Object.entries(declared)
    .filter(([name]) => name.startsWith(SCOPE_PREFIX))
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([name, spec]) => ({ name, spec, isDirect: name in direct }));
};

const versionOf = (opts: { manifest?: IManifest }): string | undefined =>
  typeof opts.manifest?.version === 'string' && opts.manifest.version.length > 0
    ? opts.manifest.version
    : undefined;

/**
 * `name` as Node resolves it from a package's real directory: its own `node_modules`, then each
 * parent's, up to `cwd`. Bun's isolated linker keeps a dependency only beside its dependent, in
 * `node_modules/.bun/<dependent>/node_modules`; npm nests it under the dependent's `node_modules`.
 */
const resolvedFrom = (opts: {
  cwd: string;
  directory: string;
  name: string;
}): string | undefined => {
  const top = realpathSync(opts.cwd);
  let current = realpathSync(opts.directory);

  while (true) {
    const version = versionOf({
      manifest: readManifest({ file: join(current, 'node_modules', opts.name, 'package.json') }),
    });
    const parent = dirname(current);

    if (version !== undefined || current === top || parent === current) {
      return version;
    }

    current = parent;
  }
};

/** The version beside a declared package that depends on `name` - what that package really runs. */
const besideDependentOf = (opts: {
  cwd: string;
  name: string;
  declared: IDeclared[];
}): string | undefined => {
  for (const dependent of opts.declared) {
    const directory = join(opts.cwd, 'node_modules', dependent.name);
    const manifest = readManifest({ file: join(directory, 'package.json') });
    const dependencies = {
      ...(manifest?.dependencies ?? {}),
      ...(manifest?.optionalDependencies ?? {}),
    };
    const version =
      opts.name in dependencies
        ? resolvedFrom({ cwd: opts.cwd, directory, name: opts.name })
        : undefined;

    if (version !== undefined) {
      return version;
    }
  }

  return undefined;
};

/**
 * The version actually on disk, else the declared spec when it is one exact version, else `null`. A
 * range is never a version: reporting `^0.2.0-11` as installed would invent a fact. A direct
 * dependency is read at the root first; a name that is only a pin (`overrides`) is read beside the
 * package that depends on it first - a root link an older direct dependency left behind is not
 * what runs.
 */
const installedVersionOf = (opts: {
  cwd: string;
  name: string;
  spec: string;
  isDirect: boolean;
  declared: IDeclared[];
}): string | null => {
  const atRoot = (): string | undefined =>
    versionOf({
      manifest: readManifest({ file: join(opts.cwd, 'node_modules', opts.name, 'package.json') }),
    });
  const beside = (): string | undefined => besideDependentOf(opts);
  const version = opts.isDirect ? (atRoot() ?? beside()) : (beside() ?? atRoot());

  if (version !== undefined) {
    return version;
  }

  return EXACT_VERSION_PATTERN.test(opts.spec) ? opts.spec : null;
};

export class InstalledVersions {
  /**
   * The `@venizia/*` versions a directory runs: what `package.json` declares, read from disk where it
   * is installed, else the exact version it pins; `null` for a direct dependency that never resolved.
   */
  static read(opts: { cwd: string }): Record<string, string | null> {
    const { cwd } = opts;
    const manifest = readManifest({ file: join(cwd, 'package.json') });

    const installed: Record<string, string | null> = {};
    const declared = declaredOf({ manifest });

    for (const { name, spec, isDirect } of declared) {
      const version = installedVersionOf({ cwd, name, spec, isDirect, declared });

      // A pin of a transitive dependency that nothing installed is not something this project has.
      if (version !== null || isDirect) {
        installed[name] = version;
      }
    }

    // A monorepo declares its framework in its apps and installs it beside them, not at the root.
    for (const root of InstalledPackages.installRootsOf({ cwd }).filter(
      (candidate) => candidate !== cwd,
    )) {
      const appDeclared = declaredOf({
        manifest: readManifest({ file: join(root, 'package.json') }),
      });

      for (const { name, spec, isDirect } of appDeclared) {
        if (installed[name] !== undefined && installed[name] !== null) {
          continue;
        }

        const version =
          installedVersionOf({ cwd: root, name, spec, isDirect, declared: appDeclared }) ??
          installedVersionOf({ cwd, name, spec, isDirect, declared });

        if (version !== null) {
          installed[name] = version;
        }
      }
    }

    return installed;
  }
}
