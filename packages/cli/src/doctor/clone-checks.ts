import { join, relative } from 'node:path';
import { ProjectLayout, RecordValue } from '../common/index.ts';
import { AgentConstants } from '../agents/common/index.ts';
import { AgentSelection, LocalChoice } from '../agents/index.ts';
import { CommitHook, CommitHookStates } from '../commit/index.ts';
import { AgentFiles, AgentsBlockPlan, SyncPlanner, SyncStatuses } from '../sync/index.ts';
import { AtlasStatus } from '@venizia/vulcan-atlas';
import { DoctorChecks } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';

/** The checks of what a clone gets from sync and install: the agent files, the commit hook, the install script and the atlas sources. */
export class CloneChecks {
  static checkAdapters(opts: ICheckContext): IViolation[] {
    const pending = SyncPlanner.plan({
      root: opts.root,
      config: opts.config,
      agents: AgentSelection.resolveQuietly({ root: opts.root, configAgents: opts.config.agents }),
    })
      .filter((action) => action.status !== SyncStatuses.UNCHANGED)
      .filter((action) => !SyncPlanner.manifestPaths({ root: opts.root }).includes(action.path));
    const absent = pending.filter((action) => action.status === SyncStatuses.CREATED);
    const differing = pending.filter((action) => action.status !== SyncStatuses.CREATED);

    // A clean checkout has none of the gitignored adapters: say so once, with the fix, not once per file.
    const violations =
      absent.length === 0
        ? []
        : [
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.ADAPTERS,
              file: relative(opts.root, absent[0].path),
              message: `not synced yet - run '${ProjectLayout.VULCAN_COMMAND} project sync' (make vulcan-sync) first`,
            }),
          ];

    return [
      ...violations,
      ...differing.map((action) =>
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.ADAPTERS,
          file: relative(opts.root, action.path),
          message:
            action.status === SyncStatuses.SKIPPED
              ? (action.note ?? 'skipped by sync')
              : `stale (${action.status}) - run '${ProjectLayout.VULCAN_COMMAND} project sync'`,
        }),
      ),
    ];
  }

  /** The developer's stored agents must parse and name known agents; a broken file would otherwise hide as a default. */
  static checkAgents(opts: ICheckContext): IViolation[] {
    const stored = LocalChoice.read({ root: opts.root });

    return stored.ok
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.AGENTS,
            file: AgentConstants.LOCAL_FILE,
            message: stored.error,
          }),
        ];
  }

  /**
   * The `commit-msg` hook of this clone, when the project turned a commit check on: a missing or out-of-date
   * one is fixed by `vulcan project sync`; one that is not ours and does not call the check, or one a project with
   * `core.hooksPath` owns, is told the line to add. Per clone, so a warning and never a violation.
   */
  static checkCommitHook(opts: ICheckContext): IViolation[] {
    const status = CommitHook.stateOf({ root: opts.root, config: opts.config });
    const file = relative(opts.root, status.path);
    const fix = `run '${ProjectLayout.VULCAN_COMMAND} project sync' (make vulcan-sync)`;

    switch (status.state) {
      case CommitHookStates.MISSING: {
        return [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook is not installed, so commit messages are not checked - ${fix}`,
          }),
        ];
      }

      case CommitHookStates.STALE: {
        return [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook is out of date - ${fix}`,
          }),
        ];
      }

      case CommitHookStates.LEGACY: {
        return [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook is out of date: ${status.note ?? fix}`,
          }),
        ];
      }

      case CommitHookStates.UNWIRED: {
        return [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook does not run the commit check - ${status.note ?? fix}`,
          }),
        ];
      }

      case CommitHookStates.OTHER_PROJECT: {
        return [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `this project's commit check is not installed: ${status.note ?? fix}`,
          }),
        ];
      }

      default: {
        return [];
      }
    }
  }

  /**
   * An atlas source the last server run could not build, could not refresh (an older index is served), or has been building
   * for over ten minutes in a server that is still running: the agents of this project read the `.d.ts` files by hand
   * until it is served. A warning with what `vulcan atlas status` prints; a build left by a closed session is not one.
   */
  static checkAtlasSources(opts: ICheckContext): IViolation[] {
    const problems = AtlasStatus.problemsOf({ root: opts.root }).filter(
      (problem) => problem.type !== 'abandoned',
    );

    return problems.length === 0
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.ATLAS_SOURCE,
            file: AtlasStatus.recordFileOf({ root: opts.root }),
            message: `an atlas source is not served as it should be: ${problems
              .map((problem) => `${problem.source}: ${problem.type} (${problem.detail})`)
              .join(' | ')} - run \`${ProjectLayout.VULCAN_COMMAND} atlas status\` for the record`,
          }),
        ];
  }

  /**
   * The root `package.json` runs `vulcan project sync` in no install script (`prepare` or `postinstall`, directly or as `make vulcan-sync`):
   * a clone that has not run it has no manifest and no hooks, and `bun install` is where one is expected to get them. A note,
   * for a project that has a root `package.json`.
   */
  static checkPrepareScript(opts: ICheckContext): IViolation[] {
    const manifest = DoctorCheckUtility.readJsonObject({ file: join(opts.root, 'package.json') });

    if (manifest === undefined) {
      return [];
    }

    const scripts: unknown = manifest['scripts'];

    const scriptOf = (name: string): string | undefined => {
      const script = RecordValue.isRecord(scripts) ? scripts[name] : undefined;

      return typeof script === 'string' ? script : undefined;
    };

    const names = ['prepare', 'postinstall'];
    const isCurrent = (script: string | undefined): boolean =>
      script !== undefined &&
      (['vulcan project sync', 'vulcan-sync'].some((text) => script.includes(text)) ||
        /vulcan\s+project\s+sync\b/.test(script));
    // The old name still runs in this release, but the script of a project is the form doctor prints now.
    const isOld = (script: string | undefined): boolean =>
      script !== undefined && !isCurrent(script) && /vulcan\s+sync\b/.test(script);
    const fix = `set "prepare": "${ProjectLayout.PREPARE_SCRIPT.replaceAll('"', '\\"')}" in scripts`;

    if (names.some((name) => isCurrent(scriptOf(name)))) {
      return [];
    }

    return [
      DoctorCheckUtility.createViolation({
        check: DoctorChecks.PREPARE,
        file: 'package.json',
        message: names.some((name) => isOld(scriptOf(name)))
          ? `the install script still uses the old \`sync\` name (no \`project\` before it), which still works in this release and goes in the next: ${fix}`
          : `no install script runs vulcan project sync: a fresh clone has no hooks until someone runs it; ${fix}`,
      }),
    ];
  }

  /** Git tracks `.claude/settings.json`: it is generated by sync in every clone, so a committed copy goes stale and drifts. A warning with the git command. */
  static checkClaudeSettingsTracked(opts: ICheckContext): IViolation[] {
    return AgentFiles.isTracked({ root: opts.root, path: ProjectLayout.CLAUDE_SETTINGS_FILE })
      ? [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.CLAUDE_SETTINGS,
            file: ProjectLayout.CLAUDE_SETTINGS_FILE,
            message: `git tracks this file, which \`vulcan project sync\` writes in every clone: run git rm --cached ${ProjectLayout.CLAUDE_SETTINGS_FILE} (sync keeps it out of git from then on)`,
          }),
        ]
      : [];
  }

  /** Info only: the Atlas or rules block of AGENTS.md is missing or no longer matches the config. */
  static checkAtlasBlock(opts: ICheckContext): IViolation[] {
    const merged = AgentsBlockPlan.merged({ root: opts.root, config: opts.config });

    return merged === undefined || !merged.changed
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.AGENTS,
            file: 'AGENTS.md',
            message: `the Atlas or rules block of AGENTS.md is missing or out of date - run '${ProjectLayout.VULCAN_COMMAND} project sync'`,
          }),
        ];
  }
}
