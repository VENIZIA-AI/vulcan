import { Glob } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { parseRuleIds, readSlots, RuleConstants } from '../rules/index.ts';
import { planSync, SyncStatuses } from '../sync/index.ts';
import { DoctorChecks, DoctorConstants } from './common/index.ts';
import type { IViolation, TDoctorCheck } from './common/index.ts';
import { parseMakeIncludes, parseMakeTargets } from './makefile.ts';

export interface ICheckContext {
  root: string;
  config: TResolvedConfig;
  configFile: string;
}

const createViolation = (opts: {
  check: TDoctorCheck;
  file: string;
  message: string;
}): IViolation => ({
  check: opts.check,
  file: opts.file,
  message: opts.message,
});

const readText = (opts: { file: string }): string =>
  existsSync(opts.file) ? readFileSync(opts.file, 'utf8') : '';

const listDirectories = (opts: { directory: string }): string[] =>
  existsSync(opts.directory)
    ? readdirSync(opts.directory, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    : [];

export const checkLayout = (opts: ICheckContext): IViolation[] =>
  ['AGENTS.md', '.agents/rules.md', opts.config.knowledge.bundle]
    .filter(path => !existsSync(join(opts.root, path)))
    .map(path =>
      createViolation({
        check: DoctorChecks.LAYOUT,
        file: path,
        message: `missing - run '${ProjectLayout.VULCAN_COMMAND} init'`,
      }),
    );

/** The base owns the `V-` namespace; a project's own IDs stay bare and can reuse any letter and number. */
export const checkRuleIds = (opts: ICheckContext): IViolation[] =>
  parseRuleIds({ markdown: readText({ file: join(opts.root, '.agents', 'rules.md') }) })
    .filter(id => id.startsWith(RuleConstants.BASE_NAMESPACE))
    .map(id =>
      createViolation({
        check: DoctorChecks.RULE_IDS,
        file: '.agents/rules.md',
        message: `${id} is in the base namespace ${RuleConstants.BASE_NAMESPACE} - give the extension a bare ID`,
      }),
    );

export const checkRuleSlots = (opts: ICheckContext): IViolation[] => {
  const slots = readSlots();
  const violations: IViolation[] = [];

  for (const [id, slot] of Object.entries(slots)) {
    const choice = opts.config.rules[id];
    const options = Object.keys(slot.options).join(' | ');

    if (choice === undefined) {
      violations.push(
        createViolation({
          check: DoctorChecks.RULE_SLOTS,
          file: opts.configFile,
          message: `${id} needs a choice: rules: { '${id}': ${options} }`,
        }),
      );
      continue;
    }

    if (slot.options[choice] === undefined) {
      violations.push(
        createViolation({
          check: DoctorChecks.RULE_SLOTS,
          file: opts.configFile,
          message: `${id}: '${choice}' is not an option (${options})`,
        }),
      );
    }
  }

  for (const id of Object.keys(opts.config.rules).filter(ruleId => slots[ruleId] === undefined)) {
    const namespaced = `${RuleConstants.BASE_NAMESPACE}${id}`;

    violations.push(
      createViolation({
        check: DoctorChecks.RULE_SLOTS,
        file: opts.configFile,
        message:
          slots[namespaced] === undefined
            ? `${id} is not a slot - only ${Object.keys(slots).join(', ')} take a choice`
            : `'${id}' is not a slot - the base rule is now '${namespaced}'`,
      }),
    );
  }

  return violations;
};

export const checkSkills = (opts: ICheckContext): IViolation[] => {
  const shipped = new Set(listDirectories({ directory: join(BASE_DIRECTORY, 'skills') }));

  return listDirectories({ directory: join(opts.root, '.agents', 'skills') })
    .filter(name => shipped.has(name))
    .map(name =>
      createViolation({
        check: DoctorChecks.SKILLS,
        file: `.agents/skills/${name}`,
        message: `'${name}' is a shipped skill - rename the project skill`,
      }),
    );
};

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

    for (const pattern of parseMakeIncludes({
      makefile: readText({ file: join(opts.root, file) }),
    })) {
      const matches = [...new Glob(pattern).scanSync({ cwd: opts.root, onlyFiles: true })].sort();

      pending.push(...matches.filter(match => !match.split('/').includes('node_modules')));
    }
  }

  return found;
};

export const checkMake = (opts: ICheckContext): IViolation[] => {
  const makefile = readText({ file: join(opts.root, 'Makefile') });
  const violations: IViolation[] = [];

  if (!DoctorConstants.MAKE_INCLUDE_PATTERN.test(makefile)) {
    violations.push(
      createViolation({
        check: DoctorChecks.MAKE,
        file: 'Makefile',
        message: `add: ${ProjectLayout.MAKE_INCLUDE_LINE}`,
      }),
    );
  }

  const shipped = new Set(
    parseMakeTargets({ makefile: readText({ file: join(BASE_DIRECTORY, 'make', 'vulcan.mk') }) }),
  );

  for (const file of findProjectMakefiles({ root: opts.root })) {
    const targets = parseMakeTargets({ makefile: readText({ file: join(opts.root, file) }) });

    for (const target of targets.filter(name => shipped.has(name))) {
      violations.push(
        createViolation({
          check: DoctorChecks.MAKE,
          file,
          message: `'${target}' is a shipped target - give the project target another name`,
        }),
      );
    }
  }

  return violations;
};

export const checkHooks = (opts: ICheckContext): IViolation[] =>
  opts.config.hooks
    .filter(hook => hook.command.includes(DoctorConstants.SHIPPED_HOOKS_PATH))
    .map(hook =>
      createViolation({
        check: DoctorChecks.HOOKS,
        file: opts.configFile,
        message: `the ${hook.event} hook runs a shipped hook - sync registers those, never the project`,
      }),
    );

export const checkAdapters = (opts: ICheckContext): IViolation[] =>
  planSync({ root: opts.root, config: opts.config })
    .filter(action => action.status !== SyncStatuses.UNCHANGED)
    .map(action =>
      createViolation({
        check: DoctorChecks.ADAPTERS,
        file: relative(opts.root, action.path),
        message:
          action.status === SyncStatuses.SKIPPED
            ? (action.note ?? 'skipped by sync')
            : `stale (${action.status}) - run '${ProjectLayout.VULCAN_COMMAND} sync'`,
      }),
    );

const hasStylePackage = (opts: { root: string }): boolean => {
  const file = join(opts.root, 'package.json');

  if (!existsSync(file)) {
    return false;
  }

  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(readFileSync(file, 'utf8'));

  return ProjectLayout.STYLE_PACKAGE in { ...manifest.dependencies, ...manifest.devDependencies };
};

/** D9: the shared coding style - the package is a dependency, and every lint config builds on it. */
export const checkStyle = (opts: ICheckContext): IViolation[] => {
  const violations: IViolation[] = [];

  if (!hasStylePackage({ root: opts.root })) {
    violations.push(
      createViolation({
        check: DoctorChecks.STYLE,
        file: 'package.json',
        message: `add ${ProjectLayout.STYLE_PACKAGE} as a devDependency`,
      }),
    );
  }

  const configDirectories = [
    '.configs',
    ...listDirectories({ directory: join(opts.root, 'packages') }).map(name =>
      join('packages', name, '.configs'),
    ),
  ];

  for (const directory of configDirectories.filter(path => existsSync(join(opts.root, path)))) {
    for (const name of readdirSync(join(opts.root, directory)).filter(file =>
      DoctorConstants.LINT_CONFIG_FILE.test(file),
    )) {
      const file = join(directory, name);

      if (!readText({ file: join(opts.root, file) }).includes(ProjectLayout.STYLE_PACKAGE)) {
        violations.push(
          createViolation({
            check: DoctorChecks.STYLE,
            file,
            message: `build on the shared style: import from ${ProjectLayout.STYLE_PACKAGE}`,
          }),
        );
      }
    }
  }

  return violations;
};
