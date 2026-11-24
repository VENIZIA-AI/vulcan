import { relative } from 'node:path';
import { LocalSettings } from '../common/local-settings.ts';
import { ConfigLoader } from '../config/index.ts';
import { ProjectContract } from './checks.ts';
import type { ICheckContext } from './checks.ts';
import { ConfigOrderCheck } from './config-order.ts';
import { FileLayoutCheck } from './file-layout.ts';
import { SkillLint } from './skills.ts';
import { TagCheck } from './tags.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

/** Runs the doctor checks and sorts their findings into violations, notes and warnings; used by `vulcan doctor`. */
export class DoctorRunner {
  /** Every violation of the VULCAN contract in the project at `root`; empty means conformant. */
  static async runChecks(opts: { root: string }): Promise<IViolation[]> {
    const loaded = await ConfigLoader.load({ root: opts.root });

    if (!loaded.ok) {
      return [
        {
          check: DoctorChecks.CONFIG,
          file: loaded.file === undefined ? '.configs/' : relative(opts.root, loaded.file),
          message: loaded.error,
        },
      ];
    }

    const context = {
      root: opts.root,
      config: loaded.config,
      configFile: relative(opts.root, loaded.file),
    };

    return [
      ...ProjectContract.checkLayout(context),
      ...ProjectContract.checkRuleIds(context),
      ...ProjectContract.checkRuleSlots(context),
      ...ProjectContract.checkSkills(context),
      ...ProjectContract.checkMake(context),
      ...ProjectContract.checkAdapters(context),
      ...ProjectContract.checkAgents(context),
      ...ProjectContract.checkManifest(context),
      ...ProjectContract.checkChangelogFolders(context),
      ...TagCheck.check(context),
      ...SkillLint.check(context),
      ...ProjectContract.checkStyle(context),
      ...ProjectContract.checkScaffold(context),
      ...ProjectContract.checkApps(context),
      ...ProjectContract.checkTmpFolder(context),
    ];
  }

  /** The context of the warnings and the notes, or `undefined` when the config does not load (the checks report it). */
  private static async contextOf(opts: { root: string }): Promise<ICheckContext | undefined> {
    const loaded = await ConfigLoader.load({ root: opts.root });

    return loaded.ok
      ? {
          root: opts.root,
          config: loaded.config,
          configFile: relative(opts.root, loaded.file),
          layers: loaded.layers,
        }
      : undefined;
  }

  /** What `vulcan doctor` prints: the violations, the warnings and the notes, with the config loaded and the layout check run once. */
  static async runReport(opts: {
    root: string;
    /** The environment of the shell running doctor; defaults to the process environment. */
    env?: Record<string, string | undefined>;
  }): Promise<{ violations: IViolation[]; warnings: IViolation[]; notes: IViolation[] }> {
    const violations = await DoctorRunner.runChecks({ root: opts.root });
    const context = await DoctorRunner.contextOf({ root: opts.root });

    if (context === undefined) {
      return { violations, warnings: [], notes: [] };
    }

    const layout = FileLayoutCheck.check(context);

    return {
      violations,
      warnings: [...DoctorRunner.warningsOf({ context }), ...layout.warnings],
      notes: [...DoctorRunner.notesOf({ context, env: opts.env }), ...layout.notes],
    };
  }

  /** Notes that never fail the doctor: what a project could change, one line each. */
  static async runNotes(opts: {
    root: string;
    /** The environment of the shell running doctor; defaults to the process environment. */
    env?: Record<string, string | undefined>;
  }): Promise<IViolation[]> {
    const context = await DoctorRunner.contextOf({ root: opts.root });

    return context === undefined
      ? []
      : [
          ...DoctorRunner.notesOf({ context, env: opts.env }),
          ...FileLayoutCheck.check(context).notes,
        ];
  }

  /** Warnings: louder than a note, still never a failure - a security gap a project made earlier may carry. */
  static async runWarnings(opts: { root: string }): Promise<IViolation[]> {
    const context = await DoctorRunner.contextOf({ root: opts.root });

    return context === undefined
      ? []
      : [...DoctorRunner.warningsOf({ context }), ...FileLayoutCheck.check(context).warnings];
  }

  private static notesOf(opts: {
    context: ICheckContext;
    env: Record<string, string | undefined> | undefined;
  }): IViolation[] {
    const { context } = opts;

    return [
      ...ProjectContract.checkConfigDefaults(context),
      ...ConfigOrderCheck.check(context),
      ...ProjectContract.checkBoardAutoStart(context),
      ...ProjectContract.checkPrepareScript(context),
      ...ProjectContract.checkAtlasBlock(context),
      ...ProjectContract.checkAcknowledgedValues(context),
      ...ProjectContract.checkOwnerReplySwitch({ env: opts.env ?? process.env }),
    ];
  }

  private static warningsOf(opts: { context: ICheckContext }): IViolation[] {
    const { context } = opts;

    return [
      ...ProjectContract.checkStaleRemove(context),
      ...ProjectContract.checkClaudeSettingsTracked(context),
      ...ProjectContract.checkAtlasSources(context),
      ...ProjectContract.checkMcpAtlas(context),
      ...ProjectContract.checkCommitHook(context),
      ...ProjectContract.checkEventsDir(context),
      ...ProjectContract.checkEventsSize(context),
      ...ProjectContract.checkProjectKey(context),
      ...ProjectContract.checkWorkspacePackages(context),
      ...ProjectContract.checkBrowserSocket({
        root: context.root,
        tmp: LocalSettings.read({ root: context.root }).tmp ?? context.config.local.tmp,
      }),
      ...ProjectContract.checkSkillTriggers(context),
      ...ProjectContract.checkFormat(context),
      ...ProjectContract.checkLocalWorkspace(context),
      ...ProjectContract.checkProfile(context),
      ...ProjectContract.checkOwnerReplySettings(context),
      ...ProjectContract.checkStaleLocal(context),
      ...ProjectContract.checkUnknownLocal(context),
      ...ProjectContract.checkPrivateValues(context),
    ];
  }
}
