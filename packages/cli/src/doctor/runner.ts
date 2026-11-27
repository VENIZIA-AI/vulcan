import { relative } from 'node:path';
import { LocalSettings } from '../common/local-settings.ts';
import { ConfigLoader } from '../config/index.ts';
import { RuleChecks } from './rule-checks.ts';
import { CloneChecks } from './clone-checks.ts';
import { WorkspaceChecks } from './workspace-checks.ts';
import { LocalChecks } from './local-checks.ts';
import { SettingsChecks } from './settings-checks.ts';
import { OwnerChecks } from './owner-checks.ts';
import { McpChecks } from './mcp-checks.ts';
import { ConfigModulesCheck, ConfigOrderCheck } from './config-order.ts';
import { FileLayoutCheck } from './file-layout.ts';
import { SkillLint } from './skills.ts';
import { TagCheck } from './tags.ts';
import { DoctorChecks } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';

/** Runs the doctor checks and sorts their findings into violations, notes and warnings; used by `vulcan project doctor`. */
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
      ...RuleChecks.checkLayout(context),
      ...RuleChecks.checkRuleIds(context),
      ...RuleChecks.checkRuleSlots(context),
      ...RuleChecks.checkSkills(context),
      ...RuleChecks.checkMake(context),
      ...CloneChecks.checkAdapters(context),
      ...CloneChecks.checkAgents(context),
      ...RuleChecks.checkManifest(context),
      ...RuleChecks.checkChangelogFolders(context),
      ...TagCheck.check(context),
      ...SkillLint.check(context),
      ...WorkspaceChecks.checkStyle(context),
      ...WorkspaceChecks.checkScaffold(context),
      ...WorkspaceChecks.checkApps(context),
      ...LocalChecks.checkTmpFolder(context),
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

  /** What `vulcan project doctor` prints: the violations, the warnings and the notes, with the config loaded and the layout check run once. */
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
      ...SettingsChecks.checkConfigDefaults(context),
      ...ConfigOrderCheck.check(context),
      ...SettingsChecks.checkBoardAutoStart(context),
      ...CloneChecks.checkPrepareScript(context),
      ...CloneChecks.checkAtlasBlock(context),
      ...OwnerChecks.checkAcknowledgedValues(context),
      ...OwnerChecks.checkOwnerReplySwitch({ env: opts.env ?? process.env }),
    ];
  }

  private static warningsOf(opts: { context: ICheckContext }): IViolation[] {
    const { context } = opts;

    return [
      ...SettingsChecks.checkStaleRemove(context),
      ...ConfigModulesCheck.check(context),
      ...CloneChecks.checkClaudeSettingsTracked(context),
      ...CloneChecks.checkAtlasSources(context),
      ...McpChecks.checkMcpAtlas(context),
      ...CloneChecks.checkCommitHook(context),
      ...SettingsChecks.checkEventsDir(context),
      ...SettingsChecks.checkEventsSize(context),
      ...SettingsChecks.checkProjectKey(context),
      ...WorkspaceChecks.checkWorkspacePackages(context),
      ...LocalChecks.checkBrowserSocket({
        root: context.root,
        tmp: LocalSettings.read({ root: context.root }).tmp ?? context.config.local.tmp,
      }),
      ...RuleChecks.checkSkillTriggers(context),
      ...WorkspaceChecks.checkFormat(context),
      ...LocalChecks.checkLocalWorkspace(context),
      ...OwnerChecks.checkProfile(context),
      ...OwnerChecks.checkOwnerReplySettings(context),
      ...LocalChecks.checkStaleLocal(context),
      ...LocalChecks.checkUnknownLocal(context),
      ...OwnerChecks.checkPrivateValues(context),
    ];
  }
}
