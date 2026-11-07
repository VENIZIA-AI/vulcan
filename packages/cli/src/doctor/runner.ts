import { relative } from 'node:path';
import { ConfigLoader } from '../config/index.ts';
import { ProjectContract } from './checks.ts';
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
      ...ProjectContract.checkHooks(context),
      ...ProjectContract.checkAdapters(context),
      ...ProjectContract.checkAgents(context),
      ...ProjectContract.checkManifest(context),
      ...TagCheck.check(context),
      ...SkillLint.check(context),
      ...ProjectContract.checkStyle(context),
      ...ProjectContract.checkScaffold(context),
      ...ProjectContract.checkApps(context),
      ...ProjectContract.checkTmpFolder(context),
    ];
  }

  /** Notes that never fail the doctor: what a project could change, one line each. */
  static async runNotes(opts: {
    root: string;
    /** The environment of the shell running doctor; defaults to the process environment. */
    env?: Record<string, string | undefined>;
  }): Promise<IViolation[]> {
    const loaded = await ConfigLoader.load({ root: opts.root });

    if (!loaded.ok) {
      return [];
    }

    const context = {
      root: opts.root,
      config: loaded.config,
      configFile: relative(opts.root, loaded.file),
    };

    return [
      ...ProjectContract.checkAtlasBlock(context),
      ...ProjectContract.checkAcknowledgedValues(context),
      ...ProjectContract.checkOwnerReplySwitch({ env: opts.env ?? process.env }),
      ...ProjectContract.checkTrustedScripts(context),
    ];
  }

  /** Warnings: louder than a note, still never a failure - a security gap a project made earlier may carry. */
  static async runWarnings(opts: { root: string }): Promise<IViolation[]> {
    const loaded = await ConfigLoader.load({ root: opts.root });

    if (!loaded.ok) {
      return [];
    }

    const context = {
      root: opts.root,
      config: loaded.config,
      configFile: relative(opts.root, loaded.file),
    };

    return [
      ...ProjectContract.checkMcpAtlas(context),
      ...ProjectContract.checkCommitHook(context),
      ...ProjectContract.checkEventsDir(context),
      ...ProjectContract.checkEventsSize(context),
      ...ProjectContract.checkProjectKey(context),
      ...ProjectContract.checkBrowserSocket({ root: opts.root, tmp: context.config.local.tmp }),
      ...ProjectContract.checkSkillTriggers(context),
      ...ProjectContract.checkFormat(context),
      ...ProjectContract.checkLocalWorkspace(context),
      ...ProjectContract.checkProfile(context),
      ...ProjectContract.checkOwnerReplySettings(context),
      ...ProjectContract.checkStaleLocal(context),
      ...ProjectContract.checkUnknownLocal(context),
      ...ProjectContract.checkStaleTrustedScripts(context),
      ...ProjectContract.checkPrivateValues(context),
    ];
  }
}
