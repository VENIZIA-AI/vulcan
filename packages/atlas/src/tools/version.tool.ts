import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { IToolHandler } from '@/protocol/common';
import type { IReleaseIndex } from '@/releases';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { parseInput, VersionInputSchema } from './common';

const DESCRIPTION =
  'Compare the @venizia/* packages installed in a directory against the newest versions this ' +
  'build knows about - the versions its generated release table carries, not the registry.';

// Built once at module load - a guarded tool that re-resolves its store on every call never needs
// to rebuild this.
const INPUT_JSON_SCHEMA = z.toJSONSchema(VersionInputSchema);

const SCOPE_PREFIX = '@venizia/';

// An exact version, not a range: `^0.2.0-11` and `>=1` name a set of versions, `0.2.0-11` names one.
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

interface IBehindRow {
  package: string;
  installed: string;
  newest: string;
}

interface IVersionResponse {
  installed: Record<string, string | null>;
  snapshot: Record<string, string>;
  behind: IBehindRow[];
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

/** The newest version the release table knows for every package in it. */
const snapshotOf = (opts: { releases: IReleaseIndex; live: string[] }): Record<string, string> => {
  const snapshot: Record<string, string> = {};

  const names = opts.releases.packages().filter(candidate => opts.live.includes(candidate));

  for (const name of names) {
    const newest = opts.releases.newestOf({ package: name });

    if (newest) {
      snapshot[name] = newest.version;
    }
  }

  return snapshot;
};

/**
 * One row per package whose installed version orders below the newest known one. An installed
 * version that never resolved, or a version neither side can parse, is skipped - never guessed.
 */
const behindOf = (opts: {
  releases: IReleaseIndex;
  installed: Record<string, string | null>;
  snapshot: Record<string, string>;
}): IBehindRow[] => {
  const rows: IBehindRow[] = [];

  const installedEntries = Object.entries(opts.installed);

  for (const [name, version] of installedEntries) {
    const packageName = opts.releases.packageOf({ package: name });
    const newest = opts.snapshot[packageName];

    if (version === null || newest === undefined) {
      continue;
    }

    if (!EXACT_VERSION_PATTERN.test(version) || !EXACT_VERSION_PATTERN.test(newest)) {
      continue;
    }

    if (Bun.semver.order(version, newest) < 0) {
      rows.push({ package: packageName, installed: version, newest });
    }
  }

  return rows;
};

export const buildVersionTool = (opts: { releases: IReleaseIndex }): IToolHandler => ({
  definition: {
    name: 'version',
    description: DESCRIPTION,
    inputSchema: INPUT_JSON_SCHEMA,
  },
  call: async ({ args }) => {
    const input = parseInput({ schema: VersionInputSchema, args });

    // Dated entries without a release (no git history) still give no version to compare.
    if (opts.releases.packages().length === 0) {
      throw new RpcError({
        code: RpcErrorCodes.INVALID_PARAMS,
        message: opts.releases.emptyReason,
      });
    }

    const cwd = input.cwd ?? process.cwd();
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

    const snapshot = snapshotOf({ releases: opts.releases, live: opts.releases.livePackages() });
    const response: IVersionResponse = {
      installed,
      snapshot,
      behind: behindOf({ releases: opts.releases, installed, snapshot }),
    };

    return response;
  },
});
