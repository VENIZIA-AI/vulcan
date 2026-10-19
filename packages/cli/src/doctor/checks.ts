import { Glob } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import { declaresWorkspaces, readWorkspaceGlobs } from '../init/index.ts';
import { resolvePackages } from '../config/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import {
  parseBaseReferences,
  readBaseRules,
  readRetiredRuleIds,
  readSlots,
  RuleConstants,
} from '../rules/index.ts';
import { ManifestConstants, projectNameOf } from '../manifest/index.ts';
import { planManifest, planPrune, planSync, SyncStatuses } from '../sync/index.ts';
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

/**
 * The base owns the `V-` namespace: a project defines its rules with bare IDs, and a `V-` ID in its
 * rules points at a base rule - one the base does not carry, or has retired, dangles.
 */
export const checkRuleIds = (opts: ICheckContext): IViolation[] => {
  const base = readBaseRules();
  const retired = new Set(readRetiredRuleIds());

  return parseBaseReferences({
    markdown: readText({ file: join(opts.root, '.agents', 'rules.md') }),
  })
    .filter(id => base[id] === undefined)
    .map(id =>
      createViolation({
        check: DoctorChecks.RULE_IDS,
        file: '.agents/rules.md',
        message: retired.has(id)
          ? `${id} is retired in the base - drop the reference`
          : `${id} is not a base rule - give the extension a bare ID`,
      }),
    );
};

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
        message: `'${name}' is a shipped skill - rename the project skill, for example to '${projectNameOf({ root: opts.root, config: opts.config })}-${name}'`,
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

export const checkAdapters = (opts: ICheckContext): IViolation[] => {
  const pending = planSync({ root: opts.root, config: opts.config })
    .filter(action => action.status !== SyncStatuses.UNCHANGED)
    .filter(action => action.path !== join(opts.root, ManifestConstants.FILE));
  const absent = pending.filter(action => action.status === SyncStatuses.CREATED);
  const differing = pending.filter(action => action.status !== SyncStatuses.CREATED);

  // A clean checkout has none of the gitignored adapters: say so once, with the fix, not once per file.
  const violations =
    absent.length === 0
      ? []
      : [
          createViolation({
            check: DoctorChecks.ADAPTERS,
            file: relative(opts.root, absent[0].path),
            message: `not synced yet - run '${ProjectLayout.VULCAN_COMMAND} sync' (make agent-setup) first`,
          }),
        ];

  return [
    ...violations,
    ...differing.map(action =>
      createViolation({
        check: DoctorChecks.ADAPTERS,
        file: relative(opts.root, action.path),
        message:
          action.status === SyncStatuses.SKIPPED
            ? (action.note ?? 'skipped by sync')
            : `stale (${action.status}) - run '${ProjectLayout.VULCAN_COMMAND} sync'`,
      }),
    ),
  ];
};

/** What `sync --prune` would remove: an old VULCAN or plugin-era hook command, a dead skill link. */
export const checkPrune = (opts: ICheckContext): IViolation[] =>
  planPrune({ root: opts.root }).map(action =>
    createViolation({
      check: DoctorChecks.PRUNE,
      file: relative(opts.root, action.path),
      message: `${action.note ?? 'stale'} - run '${ProjectLayout.VULCAN_COMMAND} sync --prune'`,
    }),
  );

/** C1: the committed manifest is what the config renders - atlas reads the file, never the config. */
export const checkManifest = (opts: ICheckContext): IViolation[] => {
  const action = planManifest({ root: opts.root, config: opts.config });

  return action.status === SyncStatuses.UNCHANGED
    ? []
    : [
        createViolation({
          check: DoctorChecks.MANIFEST,
          file: ManifestConstants.FILE,
          message: `${action.status === SyncStatuses.CREATED ? 'missing' : 'stale against the config'} - run '${ProjectLayout.VULCAN_COMMAND} sync' and commit it`,
        }),
      ];
};

const hasStylePackage = (opts: { directory: string }): boolean => {
  const file = join(opts.directory, 'package.json');

  if (!existsSync(file)) {
    return false;
  }

  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(readFileSync(file, 'utf8'));

  return ProjectLayout.STYLE_PACKAGE in { ...manifest.dependencies, ...manifest.devDependencies };
};

/**
 * D9: the shared coding style - every lint config builds on it, and the package whose `.configs/`
 * holds the config declares it, or the root does. A project with no lint config declares it at the
 * root. Owners are `packages/*` and every configured package's `path`, such as `umbras/kit`.
 */
export const checkStyle = (opts: ICheckContext): IViolation[] => {
  const violations: IViolation[] = [];
  const owners = [
    ...new Set([
      '.',
      ...listDirectories({ directory: join(opts.root, 'packages') }).map(name =>
        join('packages', name),
      ),
      ...resolvePackages({ config: opts.config }).map(
        entry => relative(opts.root, join(opts.root, entry.path)) || '.',
      ),
    ]),
  ];
  const isRootDeclared = hasStylePackage({ directory: opts.root });
  let lintConfigs = 0;

  for (const owner of owners) {
    const directory = join(owner, '.configs');
    const names = existsSync(join(opts.root, directory))
      ? readdirSync(join(opts.root, directory)).filter(file =>
          DoctorConstants.LINT_CONFIG_FILE.test(file),
        )
      : [];

    lintConfigs += names.length;

    if (
      names.length > 0 &&
      !isRootDeclared &&
      !hasStylePackage({ directory: join(opts.root, owner) })
    ) {
      violations.push(
        createViolation({
          check: DoctorChecks.STYLE,
          file: join(owner, 'package.json'),
          message: `add ${ProjectLayout.STYLE_PACKAGE} as a devDependency - here, or at the root`,
        }),
      );
    }

    for (const name of names) {
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

  if (lintConfigs === 0 && !isRootDeclared) {
    violations.push(
      createViolation({
        check: DoctorChecks.STYLE,
        file: 'package.json',
        message: `add ${ProjectLayout.STYLE_PACKAGE} as a devDependency`,
      }),
    );
  }

  return violations;
};

/**
 * The scaffold is filled in: `init` writes a config and a knowledge index to be edited, and a
 * project that never did would otherwise pass. A workspaces project declares its packages, and the
 * knowledge index drops the scaffold marker once it describes the project.
 */
export const checkScaffold = (opts: ICheckContext): IViolation[] => {
  const violations: IViolation[] = [];

  if (
    declaresWorkspaces({ root: opts.root }) &&
    resolvePackages({ config: opts.config }).length === 0
  ) {
    violations.push(
      createViolation({
        check: DoctorChecks.SCAFFOLD,
        file: opts.configFile,
        message:
          'package.json declares workspaces but the config lists no packages - add packages: [{ dir, name, path }] in release order',
      }),
    );
  }

  const index = join(opts.config.knowledge.bundle, 'index.md');

  if (readText({ file: join(opts.root, index) }).includes(ProjectLayout.SCAFFOLD_MARKER)) {
    violations.push(
      createViolation({
        check: DoctorChecks.SCAFFOLD,
        file: index,
        message: `still the scaffold - describe the project, then delete the ${ProjectLayout.SCAFFOLD_MARKER} line`,
      }),
    );
  }

  return violations;
};

/** Apps sit in the folders the user named, and every named folder is a workspace. */
export const checkApps = (opts: ICheckContext): IViolation[] => {
  const layout = opts.config.layout;

  if (layout === undefined) {
    return [];
  }

  const globs = readWorkspaceGlobs({ root: opts.root });
  const folders = Object.entries(layout).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const violations = folders
    .filter(([, folder]) => !globs.includes(`${folder}/*`))
    .map(([side, folder]) =>
      createViolation({
        check: DoctorChecks.APPS,
        file: 'package.json',
        message: `layout.${side} '${folder}' is not in package.json workspaces - add '${folder}/*'`,
      }),
    );
  const names = folders.map(([, folder]) => folder);

  for (const entry of resolvePackages({ config: opts.config }).filter(item => !item.retired)) {
    if (!names.some(folder => entry.path.startsWith(`${folder}/`))) {
      violations.push(
        createViolation({
          check: DoctorChecks.APPS,
          file: opts.configFile,
          message: `package ${entry.dir} lives at ${entry.path}, outside every layout folder (${names.join(', ')})`,
        }),
      );
    }
  }

  return violations;
};
