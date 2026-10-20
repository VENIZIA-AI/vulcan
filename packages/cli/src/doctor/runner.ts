import { relative } from 'node:path';
import { loadConfig } from '../config/index.ts';
import {
  checkAdapters,
  checkAppScripts,
  checkApps,
  checkManifest,
  checkPrune,
  checkHooks,
  checkLayout,
  checkMake,
  checkRuleIds,
  checkRuleSlots,
  checkScaffold,
  checkSkills,
  checkStyle,
} from './checks.ts';
import { checkSkillLint } from './skills.ts';
import { checkTags } from './tags.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

/** Every violation of the VULCAN contract in the project at `root`; empty means conformant. */
export const runDoctorChecks = async (opts: { root: string }): Promise<IViolation[]> => {
  const loaded = await loadConfig({ root: opts.root });

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
    ...checkLayout(context),
    ...checkRuleIds(context),
    ...checkRuleSlots(context),
    ...checkSkills(context),
    ...checkMake(context),
    ...checkHooks(context),
    ...checkAdapters(context),
    ...checkPrune(context),
    ...checkManifest(context),
    ...checkTags(context),
    ...checkSkillLint(context),
    ...checkStyle(context),
    ...checkScaffold(context),
    ...checkApps(context),
  ];
};

/** Notes that never fail the doctor: what a project could change, one line each. */
export const runDoctorNotes = async (opts: { root: string }): Promise<IViolation[]> => {
  const loaded = await loadConfig({ root: opts.root });

  if (!loaded.ok) {
    return [];
  }

  return checkAppScripts({
    root: opts.root,
    config: loaded.config,
    configFile: relative(opts.root, loaded.file),
  });
};
