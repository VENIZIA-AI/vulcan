/**
 * The `plan` job of package-release.yml: what a dispatch would release, decided before anything is built.
 *
 *   bun scripts/release/plan.ts --bump <mode> --ref <refs/heads/...> [--issue <n>] [--package <package.json>]
 *     [--train <packages folder>] [--merge-trial]
 *
 * It resolves the target version of the bump, says whether that version is a prerelease or a stable (a
 * prerelease needs no approval, a stable needs one), and refuses a branch and version that do not belong
 * together: a prerelease runs from develop, a stable from main and only over a prerelease. It prints the
 * target, writes `version`, `kind`, `npm_tag` and `develop_sha` to GITHUB_OUTPUT and a short summary to
 * GITHUB_STEP_SUMMARY, and exits 1 with every reason when it refuses.
 *
 * With `--train`, every package under the folder must carry the version of `--package` (one train, one
 * version), and the summary lists them; a mismatch is refused here rather than after the approval.
 *
 * With `--merge-trial`, a stable also tries the merge of main back into develop (merge-back.ts) and refuses
 * when it would stop; `develop_sha` is the head of develop that trial read.
 */
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MergeBackConstants, ReleaseMergeBack } from './merge-back.ts';
import { ReleaseBumps } from './release-args.ts';

export class ReleaseKinds {
  static readonly PRERELEASE = 'prerelease';
  static readonly STABLE = 'stable';
}

export class ReleaseNpmTags {
  static readonly NEXT = 'next';
  static readonly LATEST = 'latest';
}

export type TReleaseKind = typeof ReleaseKinds.PRERELEASE | typeof ReleaseKinds.STABLE;

export interface IReleasePlan {
  version: string;
  kind: TReleaseKind;
  /** The dist-tag the publish goes under: `next` for a prerelease, `latest` for a stable. */
  npmTag: typeof ReleaseNpmTags.NEXT | typeof ReleaseNpmTags.LATEST;
}

export interface IReleasePlanResult {
  plan: IReleasePlan | undefined;
  problems: string[];
}

export class ReleasePlanConstants {
  static readonly DEVELOP_REF = 'refs/heads/develop';
  static readonly MAIN_REF = 'refs/heads/main';
  static readonly DEFAULT_PACKAGE = 'packages/cli/package.json';

  /** A version the later jobs may carry in their environment: digits, an optional prerelease part, no build part. */
  static readonly VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
}

/** Decides what one dispatch of the release workflow would release, and whether it may. */
export class ReleasePlan {
  /** A version with a prerelease part (`0.4.8-0`) is a prerelease, anything else a stable. */
  static kindOf(opts: { version: string }): TReleaseKind {
    return opts.version.includes('-') ? ReleaseKinds.PRERELEASE : ReleaseKinds.STABLE;
  }

  static isVersion(opts: { value: string }): boolean {
    return ReleasePlanConstants.VERSION_PATTERN.test(opts.value);
  }

  /**
   * The version `bump` gives from `currentVersion`, by `npm version` itself in a scratch folder: its
   * arithmetic (for example `0.4.8-3` plus `patch` is `0.4.8`) is the one the publish job applies, so the
   * two cannot disagree. `none` is the current version.
   */
  static targetOf(opts: { bump: string; currentVersion: string; scratchRoot: string }): string {
    if (opts.bump === ReleaseBumps.NONE) {
      return opts.currentVersion;
    }

    const directory = mkdtempSync(join(opts.scratchRoot, 'release-plan-'));

    try {
      writeFileSync(
        join(directory, 'package.json'),
        `${JSON.stringify({ name: 'release-plan-scratch', version: opts.currentVersion })}\n`,
      );

      const child = Bun.spawnSync(['npm', 'version', opts.bump, '--no-git-tag-version'], {
        cwd: directory,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (child.exitCode !== 0) {
        throw new Error(
          `npm version ${opts.bump} from ${opts.currentVersion}: ${child.stderr.toString().trim()}`,
        );
      }

      const { version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));

      if (typeof version !== 'string') {
        throw new Error(`npm version ${opts.bump} from ${opts.currentVersion} wrote no version`);
      }

      return version;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  /** Why a version of this kind may not run from this ref; empty when it may. */
  static checkRef(opts: { ref: string; kind: TReleaseKind }): string[] {
    const { DEVELOP_REF, MAIN_REF } = ReleasePlanConstants;

    if (opts.ref !== DEVELOP_REF && opts.ref !== MAIN_REF) {
      return [
        `the release workflow runs from develop (a prerelease) or main (a stable), not ${opts.ref}`,
      ];
    }

    if (opts.kind === ReleaseKinds.PRERELEASE && opts.ref === MAIN_REF) {
      return ['a prerelease runs from develop, not main'];
    }

    if (opts.kind === ReleaseKinds.STABLE && opts.ref === DEVELOP_REF) {
      return ['a stable release runs from main, not develop'];
    }

    return [];
  }

  /**
   * A stable bump needs a prerelease to promote: over a version that is already a stable it would invent a
   * new one nobody tested on `next`. `none` publishes what is there and is how a half-finished run is healed.
   */
  static checkPromotion(opts: {
    bump: string;
    currentVersion: string;
    kind: TReleaseKind;
  }): string[] {
    const promotes = opts.bump !== ReleaseBumps.NONE && opts.kind === ReleaseKinds.STABLE;

    return promotes && ReleasePlan.kindOf({ version: opts.currentVersion }) === ReleaseKinds.STABLE
      ? [
          `main is at ${opts.currentVersion}, a stable: a stable bump promotes a prerelease, so there is nothing to promote (a stable already exists for it)`,
        ]
      : [];
  }

  static plan(opts: {
    bump: string;
    ref: string;
    currentVersion: string;
    scratchRoot: string;
    /** The issue number the release commit serves; empty or absent for none. */
    issue?: string;
  }): IReleasePlanResult {
    const problems: string[] = [];

    if (!ReleaseBumps.isValid(opts.bump)) {
      problems.push(
        `the bump '${opts.bump}' is not one of: ${[...ReleaseBumps.SCHEME_SET].join(', ')}`,
      );
    }

    if (opts.issue !== undefined && opts.issue !== '' && !/^\d+$/.test(opts.issue)) {
      problems.push(`the issue must be a number, not '${opts.issue}'`);
    }

    if (!ReleasePlan.isVersion({ value: opts.currentVersion })) {
      problems.push(`the version in package.json is not a plain version: '${opts.currentVersion}'`);
    }

    if (problems.length > 0) {
      return { plan: undefined, problems };
    }

    const version = ReleasePlan.targetOf(opts);

    if (!ReleasePlan.isVersion({ value: version })) {
      return {
        plan: undefined,
        problems: [`the target of '${opts.bump}' is not a plain version: '${version}'`],
      };
    }

    const kind = ReleasePlan.kindOf({ version });

    return {
      plan: {
        version,
        kind,
        npmTag: kind === ReleaseKinds.PRERELEASE ? ReleaseNpmTags.NEXT : ReleaseNpmTags.LATEST,
      },
      problems: [
        ...ReleasePlan.checkRef({ ref: opts.ref, kind }),
        ...(opts.ref === ReleasePlanConstants.MAIN_REF
          ? ReleasePlan.checkPromotion({
              bump: opts.bump,
              currentVersion: opts.currentVersion,
              kind,
            })
          : []),
      ],
    };
  }

  /** The `name@version` of every package under `directory` that has a package.json. */
  static readTrain(opts: { directory: string }): string[] {
    return readdirSync(opts.directory)
      .map((entry) => join(opts.directory, entry, 'package.json'))
      .filter((path) => existsSync(path))
      .map((path) => {
        const { name, version } = JSON.parse(readFileSync(path, 'utf8'));

        return `${String(name)}@${String(version)}`;
      });
  }

  /** One train has one version: why the packages do not all carry `version`; empty when they do. */
  static trainProblems(opts: { train: string[]; version: string }): string[] {
    const apart = opts.train.filter((entry) => !entry.endsWith(`@${opts.version}`));

    return apart.length === 0
      ? []
      : [`the packages are one train at ${opts.version}, but ${apart.join(', ')} differ`];
  }

  /** What the run page shows about the plan: the target, and who has to approve it. */
  static summaryOf(opts: {
    plan: IReleasePlan;
    bump: string;
    ref: string;
    train?: string[];
  }): string {
    const approval =
      opts.plan.kind === ReleaseKinds.STABLE
        ? 'one approval, on the release-approval environment'
        : 'none (a prerelease needs no approval)';

    return [
      '### Release plan',
      '',
      `- Target: **${opts.plan.version}** (${opts.plan.kind}), from \`${opts.bump}\` on \`${opts.ref}\``,
      `- Published under the \`${opts.plan.npmTag}\` dist-tag`,
      `- Approval: ${approval}`,
      ...(opts.train === undefined ? [] : [`- Packages: ${opts.train.join(', ')}`]),
      '',
    ].join('\n');
  }

  static main(opts: {
    args: string[];
    env: Record<string, string | undefined>;
    /** The directory the merge trial runs git in; the process's own when absent. */
    cwd?: string;
  }): number {
    const { args } = opts;
    const bump = ReleaseMergeBack.flagValue({ args, flag: '--bump' });
    const ref = ReleaseMergeBack.flagValue({ args, flag: '--ref' });
    const scratchRoot = opts.env['RUNNER_TEMP'] ?? tmpdir();
    // The issue is read as given, even when it starts with `--`: the workflow passes the same input to the
    // commit message, so a value that is not a number must be refused here, not skipped as a missing value.
    const issueIndex = args.indexOf('--issue');
    const issue = issueIndex === -1 ? undefined : (args[issueIndex + 1] ?? '');
    const packagePath =
      ReleaseMergeBack.flagValue({ args, flag: '--package' }) ??
      ReleasePlanConstants.DEFAULT_PACKAGE;
    const trainFolder = ReleaseMergeBack.flagValue({ args, flag: '--train' });

    if (bump === undefined || ref === undefined) {
      console.error('plan: --bump <mode> and --ref <refs/heads/...> are required');

      return 2;
    }

    const { version: currentVersion } = JSON.parse(readFileSync(packagePath, 'utf8'));

    if (typeof currentVersion !== 'string') {
      console.error(`plan: ${packagePath} has no version`);

      return 2;
    }

    let result: IReleasePlanResult;

    try {
      result = ReleasePlan.plan({
        bump,
        ref,
        currentVersion,
        issue,
        scratchRoot,
      });
    } catch (error) {
      console.error(`ERROR | ${error instanceof Error ? error.message : String(error)}`);

      return 1;
    }

    const train =
      trainFolder === undefined ? undefined : ReleasePlan.readTrain({ directory: trainFolder });

    if (result.plan !== undefined && train !== undefined) {
      result.problems.push(...ReleasePlan.trainProblems({ train, version: currentVersion }));
    }

    if (result.plan !== undefined) {
      console.log(`plan: ${result.plan.version} (${result.plan.kind}) from ${bump} on ${ref}`);
    }

    for (const problem of result.problems) {
      console.error(`ERROR | ${problem}`);
    }

    if (result.plan === undefined || result.problems.length > 0) {
      return 1;
    }

    const output = opts.env['GITHUB_OUTPUT'];
    const summary = opts.env['GITHUB_STEP_SUMMARY'];
    let developSha = '';

    // The merge back of a stable is tried here, before anyone is asked to approve: a stop after the click would
    // need a second click on the re-run.
    if (result.plan.kind === ReleaseKinds.STABLE && args.includes('--merge-trial')) {
      const trial = ReleaseMergeBack.trial({
        cwd: opts.cwd ?? process.cwd(),
        version: result.plan.version,
        main: opts.env['GITHUB_SHA'] ?? MergeBackConstants.DEFAULT_MAIN,
        develop: MergeBackConstants.DEFAULT_DEVELOP,
        scratchRoot,
      });

      developSha = trial.developHead;

      if (summary !== undefined) {
        appendFileSync(
          summary,
          ReleaseMergeBack.summaryOf({ result: trial, version: result.plan.version }),
        );
      }

      for (const problem of trial.problems) {
        console.error(`ERROR | merge back: ${problem}`);
      }

      if (trial.problems.length > 0) {
        return 1;
      }

      console.log(
        `plan: the merge of main into develop goes through (resolved: ${trial.resolved.join(', ') || 'none'})`,
      );
    }

    if (output !== undefined) {
      appendFileSync(
        output,
        `version=${result.plan.version}\nkind=${result.plan.kind}\nnpm_tag=${result.plan.npmTag}\ndevelop_sha=${developSha}\n`,
      );
    }

    if (summary !== undefined) {
      appendFileSync(summary, ReleasePlan.summaryOf({ plan: result.plan, bump, ref, train }));
    }

    return 0;
  }
}

if (import.meta.main) {
  process.exit(ReleasePlan.main({ args: process.argv.slice(2), env: process.env }));
}
