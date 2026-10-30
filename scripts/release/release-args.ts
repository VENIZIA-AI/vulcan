/** The `bump` choices package-release.yml offers; `none` publishes the version already in package.json. */
export class ReleaseBumps {
  static readonly PRERELEASE = 'prerelease';
  static readonly PREPATCH = 'prepatch';
  static readonly PREMINOR = 'preminor';
  static readonly PREMAJOR = 'premajor';
  static readonly PATCH = 'patch';
  static readonly MINOR = 'minor';
  static readonly MAJOR = 'major';
  static readonly NONE = 'none';

  static readonly SCHEME_SET = new Set<string>([
    this.PRERELEASE,
    this.PREPATCH,
    this.PREMINOR,
    this.PREMAJOR,
    this.PATCH,
    this.MINOR,
    this.MAJOR,
    this.NONE,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }

  /**
   * The branch a bump runs from: a bump that gives a stable (`patch`, `minor`, `major`) runs from main, a bump
   * that gives a prerelease from develop. `none` publishes what is there, so it follows `--branch` and is
   * develop without it.
   */
  static branchOf(opts: { bump: string }): string {
    return [this.PATCH, this.MINOR, this.MAJOR].includes(opts.bump)
      ? ReleaseConstants.STABLE_BRANCH
      : ReleaseConstants.BRANCH;
  }
}

/** What a release is by its version: a version with a prerelease part is a prerelease, anything else a stable. */
export class ReleaseKinds {
  static readonly PRERELEASE = 'prerelease';
  static readonly STABLE = 'stable';
}

export type TReleaseKind = typeof ReleaseKinds.PRERELEASE | typeof ReleaseKinds.STABLE;

export class ReleaseConstants {
  static readonly WORKFLOW = 'package-release.yml';
  static readonly BRANCH = 'develop';
  static readonly STABLE_BRANCH = 'main';
  /** How long after the publish a tarball may stay unserved (IGNIS saw about 8 minutes; npm has taken 16). */
  static readonly TARBALL_WAIT_MS = 20 * 60 * 1000;
  static readonly TARBALL_POLL_MS = 10 * 1000;
}

export interface IReleaseArgs {
  bump: string;
  issue: string | undefined;
  /** The branch the run is dispatched on and the checkout is compared with. */
  branch: string;
  isDryRun: boolean;
  isConfirmed: boolean;
}

const VALUE_FLAGS = new Set(['--bump', '--issue', '--branch']);
const BOOLEAN_FLAGS = new Set(['--dry-run', '--yes']);

/** Reads `[--bump <mode>] [--issue <n>] [--branch <develop|main>] [--dry-run] [--yes]`; throws on anything else. */
export const parseReleaseArgs = (opts: { args: string[] }): IReleaseArgs => {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < opts.args.length; index++) {
    const arg = opts.args[index];

    if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
      continue;
    }

    if (!VALUE_FLAGS.has(arg)) {
      throw new Error(`unknown argument '${arg}'`);
    }

    const value = opts.args[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} needs a value`);
    }

    values.set(arg, value);
    index++;
  }

  const bump = values.get('--bump') ?? ReleaseBumps.PRERELEASE;

  if (!ReleaseBumps.isValid(bump)) {
    throw new Error(`--bump '${bump}' is not one of: ${[...ReleaseBumps.SCHEME_SET].join(', ')}`);
  }

  const issue = values.get('--issue');

  if (issue !== undefined && !/^\d+$/.test(issue)) {
    throw new Error(`--issue needs an issue number, got: ${issue}`);
  }

  const branches = [ReleaseConstants.BRANCH, ReleaseConstants.STABLE_BRANCH];
  const branch = values.get('--branch') ?? ReleaseBumps.branchOf({ bump });

  if (!branches.includes(branch)) {
    throw new Error(`--branch '${branch}' is not one of: ${branches.join(', ')}`);
  }

  return {
    bump,
    issue,
    branch,
    isDryRun: booleans.has('--dry-run'),
    isConfirmed: booleans.has('--yes'),
  };
};

/**
 * The `gh` command that dispatches one release of the whole okf/atlas/cli train. The ref is always named,
 * never left to the repository's default branch: develop for a prerelease, main for a stable. An issue is sent
 * only when there is one.
 */
export const buildDispatchCommand = (opts: { args: IReleaseArgs }): string[] => [
  'gh',
  'workflow',
  'run',
  ReleaseConstants.WORKFLOW,
  '--ref',
  opts.args.branch,
  '-f',
  `bump=${opts.args.bump}`,
  ...(opts.args.issue === undefined ? [] : ['-f', `issue=${opts.args.issue}`]),
];

/**
 * Why the release would publish something other than the tree the operator is looking at: the
 * workflow builds origin/<target> (develop, or main for a stable), so a dirty, unpushed or stale checkout is
 * not what ships.
 */
export const findReleaseBlockers = (opts: {
  branch: string;
  dirtyPaths: number;
  ahead: number;
  behind: number;
  /** The branch the run is dispatched on; develop when absent. */
  target?: string;
}): string[] => {
  const branch = opts.target ?? ReleaseConstants.BRANCH;
  const blockers: string[] = [];

  if (opts.branch !== branch) {
    blockers.push(`On '${opts.branch}', not '${branch}'. The workflow releases from '${branch}'.`);
  }

  if (opts.dirtyPaths > 0) {
    blockers.push(
      `Working tree is not clean - ${opts.dirtyPaths} path(s). The workflow builds from the remote, so uncommitted work would NOT be released.`,
    );
  }

  if (opts.ahead > 0) {
    blockers.push(
      `${opts.ahead} commit(s) not pushed. The workflow builds origin/${branch}; push first.`,
    );
  }

  if (opts.behind > 0) {
    blockers.push(
      `${opts.behind} commit(s) behind origin/${branch}. Pull first, or you will read stale versions.`,
    );
  }

  return blockers;
};

/**
 * What the run really published, from the `+ <name>@<version>` line the publish step prints for each package. A green run is
 * not proof - it can publish and still fail, or go green having published nothing - and the
 * registry shows a new version minutes late (IGNIS measured 3 to 16).
 */
export const findPublishedVersions = (opts: {
  log: string;
  packageNames: string[];
}): Record<string, string | undefined> => {
  const lines = opts.log.split('\n').filter((line) => !line.includes('echo'));

  return Object.fromEntries(
    opts.packageNames.map((name) => {
      const marker = `+ ${name}@`;
      const line = lines.find((entry) => entry.includes(marker));

      return [name, line?.slice(line.indexOf(marker) + marker.length).trim()];
    }),
  );
};
