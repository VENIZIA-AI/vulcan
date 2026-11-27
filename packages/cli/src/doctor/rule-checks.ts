import { Glob } from 'bun';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import { BaseRules, RulePacks, RuleParser, RuleSlots } from '../rules/index.ts';
import { ManifestConstants, ProjectManifest } from '../manifest/index.ts';
import { SyncPlanner, SyncStatuses } from '../sync/index.ts';
import { SkillCatalog, VersionFolders } from '@venizia/vulcan-atlas';
import { DoctorChecks, DoctorConstants } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { Makefile } from './makefile.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';

/**
 * The project's Makefile and every file it includes, recursively, relative to the root. Includes
 * under node_modules are shipped (vulcan.mk), never project targets.
 */
const findProjectMakefiles = (opts: { root: string }): string[] => {
  const found: string[] = [];
  const pending = ['Makefile'];

  while (pending.length > 0) {
    const file = pending.shift() ?? '';

    if (found.includes(file) || !existsSync(join(opts.root, file))) {
      continue;
    }

    found.push(file);

    for (const pattern of Makefile.parseMakeIncludes({
      makefile: DoctorCheckUtility.readText({ file: join(opts.root, file) }),
    })) {
      const matches = [...new Glob(pattern).scanSync({ cwd: opts.root, onlyFiles: true })].sort();

      pending.push(...matches.filter((match) => !match.split('/').includes('node_modules')));
    }
  }

  return found;
};

/** The checks of what the VULCAN contract asks a project to hold: the required files, rules, skills, make targets, manifest and changelog folders. */
export class RuleChecks {
  static checkLayout(opts: ICheckContext): IViolation[] {
    return ['AGENTS.md', '.agents/rules.md', opts.config.knowledge.bundle]
      .filter((path) => !existsSync(join(opts.root, path)))
      .map((path) =>
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.LAYOUT,
          file: path,
          message: `missing - run '${ProjectLayout.VULCAN_COMMAND} project init'`,
        }),
      );
  }

  /**
   * The base owns the `V-` namespace: a project defines its rules with bare IDs, and a `V-` ID in its
   * rules points at a base rule - one the base does not carry dangles.
   */
  static checkRuleIds(opts: ICheckContext): IViolation[] {
    const base = BaseRules.read({ packs: opts.config.packs });

    return RuleParser.parseBaseReferences({
      markdown: DoctorCheckUtility.readText({ file: join(opts.root, '.agents', 'rules.md') }),
    })
      .filter((id) => base[id] === undefined)
      .map((id) => {
        const pack = RulePacks.holderOf({ id });

        return DoctorCheckUtility.createViolation({
          check: DoctorChecks.RULE_IDS,
          file: '.agents/rules.md',
          message:
            pack === undefined
              ? `${id} is not a base rule - give the extension a bare ID`
              : `${id} is in the ${pack} pack - add '${pack}' to agent.packs in the config`,
        });
      });
  }

  static checkRuleSlots(opts: ICheckContext): IViolation[] {
    const slots = RuleSlots.read();
    const violations: IViolation[] = [];

    for (const [id, slot] of Object.entries(slots)) {
      const choice = opts.config.rules[id];
      const options = Object.keys(slot.options).join(' | ');

      if (choice === undefined) {
        violations.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.RULE_SLOTS,
            file: opts.configFile,
            message: `${id} needs a choice: rules: { '${id}': ${options} }`,
          }),
        );
        continue;
      }

      if (slot.options[choice] === undefined) {
        violations.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.RULE_SLOTS,
            file: opts.configFile,
            message: `${id}: '${choice}' is not an option (${options})`,
          }),
        );
      }
    }

    for (const id of Object.keys(opts.config.rules).filter(
      (ruleId) => slots[ruleId] === undefined,
    )) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.RULE_SLOTS,
          file: opts.configFile,
          message: `${id} is not a slot - only ${Object.keys(slots).join(', ')} take a choice`,
        }),
      );
    }

    return violations;
  }

  static checkSkills(opts: ICheckContext): IViolation[] {
    const shipped = new Set(
      DoctorCheckUtility.listDirectories({ directory: join(BASE_DIRECTORY, 'skills') }),
    );

    return DoctorCheckUtility.listDirectories({ directory: join(opts.root, '.agents', 'skills') })
      .filter((name) => shipped.has(name))
      .map((name) =>
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.SKILLS,
          file: `.agents/skills/${name}`,
          message: `'${name}' is a shipped skill - rename the project skill, for example to '${ProjectManifest.projectNameOf({ root: opts.root, config: opts.config })}-${name}'`,
        }),
      );
  }

  static checkMake(opts: ICheckContext): IViolation[] {
    const makefile = DoctorCheckUtility.readText({ file: join(opts.root, 'Makefile') });
    const violations: IViolation[] = [];

    if (!DoctorConstants.MAKE_INCLUDE_PATTERN.test(makefile)) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.MAKE,
          file: 'Makefile',
          message: `add: ${ProjectLayout.MAKE_INCLUDE_LINE}`,
        }),
      );
    }

    const shipped = new Set(
      Makefile.parseMakeTargets({
        makefile: DoctorCheckUtility.readText({ file: join(BASE_DIRECTORY, 'make', 'vulcan.mk') }),
      }),
    );

    for (const file of findProjectMakefiles({ root: opts.root })) {
      const targets = Makefile.parseMakeTargets({
        makefile: DoctorCheckUtility.readText({ file: join(opts.root, file) }),
      });

      for (const target of targets.filter((name) => shipped.has(name))) {
        violations.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.MAKE,
            file,
            message: `'${target}' is a shipped target - give the project target another name`,
          }),
        );
      }
    }

    return violations;
  }

  /**
   * C1: the committed manifest is what the config renders - atlas reads the file, never the config.
   * A hand-edited one, or one without the `$generated` note, is not.
   */
  static checkManifest(opts: ICheckContext): IViolation[] {
    return SyncPlanner.planManifest({ root: opts.root, config: opts.config })
      .filter((action) => action.status !== SyncStatuses.UNCHANGED)
      .map((action) => {
        const file = relative(opts.root, action.path);
        const sync = `run '${ProjectLayout.VULCAN_COMMAND} project sync'`;
        const isCommitted = file !== ManifestConstants.FILE;
        const fix = isCommitted ? `${sync} and commit it` : sync;
        const temporary =
          file === ManifestConstants.LEGACY_FILE
            ? ' (a temporary copy of the descriptor for atlas of 0.5.0-6 and before, kept until the stable 0.5.0 release)'
            : '';

        if (action.status === SyncStatuses.REMOVED) {
          return DoctorCheckUtility.createViolation({
            check: DoctorChecks.MANIFEST,
            file,
            message: `left from an earlier sync: a repository that publishes no package has no descriptor - ${sync}, which deletes it`,
          });
        }

        return DoctorCheckUtility.createViolation({
          check: DoctorChecks.MANIFEST,
          file,
          message:
            action.status === SyncStatuses.CREATED
              ? `missing${temporary} - ${fix}`
              : `stale against the config, or edited by hand${temporary} - the manifest is generated, never edit it: edit .configs/vulcan.config.* and ${fix}`,
        });
      });
  }

  /**
   * The changelog folders `changelogs/<X.Y.Z>/` are read by the atlas of VULCAN `CHANGELOG_FOLDERS_FROM` and later;
   * an older one ignores them and answers with no changelog at all. A project that holds a folder with a `log.md`
   * and has an older vulcan installed is told which to install. The version is compared whole: a prerelease of
   * the line before the one that carries the reader still ignores the folders.
   */
  static checkChangelogFolders(opts: ICheckContext): IViolation[] {
    const { changelogs } = opts.config.knowledge;

    if (changelogs === undefined) {
      return [];
    }

    const directory = resolve(opts.root, changelogs);
    const hasFolder =
      existsSync(directory) &&
      readdirSync(directory).some(
        (name) => VersionFolders.isName({ name }) && existsSync(join(directory, name, 'log.md')),
      );
    const installedAt = join(opts.root, 'node_modules', '@venizia', 'vulcan');
    const installed = DoctorCheckUtility.readJsonObject({
      file: join(installedAt, 'package.json'),
    })?.['version'];

    if (!hasFolder || typeof installed !== 'string') {
      return [];
    }

    // VULCAN's own repository links its workspace package there: that is the source of this project, not an older release.
    try {
      const real = realpathSync(installedAt);
      const fromRoot = relative(realpathSync(opts.root), real);

      if (
        !isAbsolute(fromRoot) &&
        !fromRoot.startsWith('..') &&
        !fromRoot.split(sep).includes('node_modules')
      ) {
        return [];
      }
    } catch {
      // A link that does not resolve is judged by the version it names.
    }

    return Bun.semver.order(installed, DoctorConstants.CHANGELOG_FOLDERS_FROM) >= 0
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.CHANGELOG_FOLDERS,
            file: changelogs,
            message: `holds version folders, but the installed @venizia/vulcan is ${installed}: its atlas ignores them. Install ${DoctorConstants.CHANGELOG_FOLDERS_FROM} or later`,
          }),
        ];
  }

  /** A skill with no "Use when" part gives the atlas server's instructions nothing to say when to load it: a warning, never a failure. */
  static checkSkillTriggers(opts: ICheckContext): IViolation[] {
    return SkillCatalog.catalogOf({ root: opts.root })
      .filter((entry) => !SkillCatalog.triggerOf({ description: entry.description }).hasUseWhen)
      .map((entry) =>
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.SKILLS,
          file: entry.source === 'project' ? `.agents/skills/${entry.name}/SKILL.md` : entry.name,
          message: `'${entry.name}' has no "Use when" part in its description - atlas cannot say when to load it`,
        }),
      );
  }
}
