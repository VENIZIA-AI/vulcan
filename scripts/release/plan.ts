/**
 * The `plan` job of package-release.yml: what a dispatch would release, decided before anything is built.
 *
 *   bun scripts/release/plan.ts --bump <mode> --ref <refs/heads/...> [--package <package.json>]
 *
 * It resolves the target version of the bump, says whether that version is a prerelease or a stable (a
 * prerelease needs no approval, a stable needs one), and refuses a branch and version that do not belong
 * together. It prints the target, writes `version`, `kind` and `npm_tag` to GITHUB_OUTPUT and a short
 * summary to GITHUB_STEP_SUMMARY, and exits 1 with every reason when it refuses.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseBumps } from './release-args.ts';

export type TReleaseKind = 'prerelease' | 'stable';

export interface IReleasePlan {
  version: string;
  kind: TReleaseKind;
  /** The dist-tag the publish goes under: `next` for a prerelease, `latest` for a stable. */
  npmTag: 'next' | 'latest';
}

export interface IReleasePlanResult {
  plan: IReleasePlan | undefined;
  problems: string[];
}

export class ReleasePlanConstants {
  static readonly DEVELOP_REF = 'refs/heads/develop';
  static readonly MAIN_REF = 'refs/heads/main';
  static readonly DEFAULT_PACKAGE = 'packages/cli/package.json';

  /** Said for a stable until its own steps exist (the release commit on main and the merge back into develop). */
  static readonly STABLE_PENDING =
    'a stable release is not available yet: its steps (the release commit on main and the merge back into develop) arrive with slice S3 of the release card, and this workflow refuses a stable until then';
}

/** Decides what one dispatch of the release workflow would release, and whether it may. */
export class ReleasePlan {
  /** A version with a prerelease part (`0.4.8-0`) is a prerelease, anything else a stable. */
  static kindOf(opts: { version: string }): TReleaseKind {
    return opts.version.includes('-') ? 'prerelease' : 'stable';
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

      const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version;

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
    const { DEVELOP_REF, MAIN_REF, STABLE_PENDING } = ReleasePlanConstants;

    if (opts.ref !== DEVELOP_REF && opts.ref !== MAIN_REF) {
      return [
        `the release workflow runs from develop (a prerelease) or main (a stable), not ${opts.ref}`,
      ];
    }

    if (opts.kind === 'prerelease' && opts.ref === MAIN_REF) {
      return ['a prerelease runs from develop, not main'];
    }

    if (opts.kind === 'stable' && opts.ref === DEVELOP_REF) {
      return ['a stable release runs from main, not develop'];
    }

    return opts.kind === 'stable' ? [STABLE_PENDING] : [];
  }

  static plan(opts: {
    bump: string;
    ref: string;
    currentVersion: string;
    scratchRoot: string;
  }): IReleasePlanResult {
    if (!ReleaseBumps.isValid(opts.bump)) {
      return {
        plan: undefined,
        problems: [
          `the bump '${opts.bump}' is not one of: ${[...ReleaseBumps.SCHEME_SET].join(', ')}`,
        ],
      };
    }

    const version = ReleasePlan.targetOf(opts);
    const kind = ReleasePlan.kindOf({ version });
    const problems = ReleasePlan.checkRef({ ref: opts.ref, kind });

    return {
      plan: { version, kind, npmTag: kind === 'prerelease' ? 'next' : 'latest' },
      problems,
    };
  }

  /** What the run page shows about the plan: the target, and who has to approve it. */
  static summaryOf(opts: { plan: IReleasePlan; bump: string; ref: string }): string {
    const approval =
      opts.plan.kind === 'stable'
        ? 'one approval, on the release-approval environment'
        : 'none (a prerelease needs no approval)';

    return [
      `### Release plan`,
      '',
      `- Target: **${opts.plan.version}** (${opts.plan.kind}), from \`${opts.bump}\` on \`${opts.ref}\``,
      `- Published under the \`${opts.plan.npmTag}\` dist-tag`,
      `- Approval: ${approval}`,
      '',
    ].join('\n');
  }

  static main(opts: { args: string[]; env: Record<string, string | undefined> }): number {
    const read = (flag: string): string | undefined => {
      const index = opts.args.indexOf(flag);

      return index === -1 ? undefined : opts.args[index + 1];
    };
    const bump = read('--bump');
    const ref = read('--ref');
    const packagePath = read('--package') ?? ReleasePlanConstants.DEFAULT_PACKAGE;

    if (bump === undefined || ref === undefined) {
      console.error('plan: --bump <mode> and --ref <refs/heads/...> are required');

      return 2;
    }

    const currentVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version;

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
        scratchRoot: opts.env['RUNNER_TEMP'] ?? tmpdir(),
      });
    } catch (error) {
      console.error(`ERROR | ${error instanceof Error ? error.message : String(error)}`);

      return 1;
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

    if (output !== undefined) {
      appendFileSync(
        output,
        `version=${result.plan.version}\nkind=${result.plan.kind}\nnpm_tag=${result.plan.npmTag}\n`,
      );
    }

    if (summary !== undefined) {
      appendFileSync(summary, ReleasePlan.summaryOf({ plan: result.plan, bump, ref }));
    }

    return 0;
  }
}

if (import.meta.main) {
  process.exit(ReleasePlan.main({ args: process.argv.slice(2), env: process.env }));
}
