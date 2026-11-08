import { Glob } from 'bun';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout, RecordValue } from '../common/index.ts';
import { LayoutKeys, LayoutFolder } from '../common/layout-folder.ts';
import { MCP_SERVER_HINT, ProjectScaffold } from '../init/index.ts';
import { ProjectPackages } from '../config/index.ts';
import { ProjectKey } from '../events/project-key.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { BaseRules, RulePacks, RuleParser, RuleSlots } from '../rules/index.ts';
import { ManifestConstants, ProjectManifest } from '../manifest/index.ts';
import { AgentScopes, AgentSelection, AgentTable, LocalChoice } from '../agents/index.ts';
import { CommitHook, CommitHookStates } from '../commit/index.ts';
import { EventConstants } from '../events/common/index.ts';
import { EventRetention } from '../events/retention.ts';
import { EventSettings } from '../events/settings.ts';
import {
  AgentFiles,
  AgentsBlockPlan,
  LocalPlan,
  SyncPlanner,
  SyncStatuses,
} from '../sync/index.ts';
import { BrowserSocket, LocalFormat, LocalScan, LocalStates } from '../local/index.ts';
import { CLAUDE_LAUNCH_FILE } from '../sync/claude-launch.ts';
import { PrivateValues } from './private-values.ts';
import { ReplySwitch, OwnerConstants, OwnerReplySwitch, OwnerProfile } from '../owner/index.ts';
import { SkillCatalog } from '@venizia/vulcan-atlas';
import { HookConstants, ProjectTmp } from '../hooks/index.ts';
import { DoctorChecks, DoctorConstants, PrivateValueKinds } from './common/index.ts';
import type { IViolation, TDoctorCheck } from './common/index.ts';
import { Makefile } from './makefile.ts';

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
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

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
      makefile: readText({ file: join(opts.root, file) }),
    })) {
      const matches = [...new Glob(pattern).scanSync({ cwd: opts.root, onlyFiles: true })].sort();

      pending.push(...matches.filter((match) => !match.split('/').includes('node_modules')));
    }
  }

  return found;
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

const readScriptNames = (opts: { file: string }): string[] | undefined => {
  if (!existsSync(opts.file)) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));
    const scripts =
      typeof parsed === 'object' && parsed !== null && 'scripts' in parsed ? parsed.scripts : {};

    return typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : [];
  } catch (error) {
    console.error(
      `[readScriptNames] ${opts.file} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

const CANONICAL_ATLAS_ARGS = ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp', '--root', '.'];

const MCP_FILE = '.mcp.json';

const CLAUDE_SETTINGS_FILE = '.claude/settings.json';

const ATLAS_SERVER = 'atlas';

const readJsonObject = (opts: { file: string }): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));

    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined;
  } catch {
    return undefined;
  }
};

/** Whether git lists the file as untracked and not ignored: what a clean-tree check, such as a release, refuses on. */
const isUntrackedAndVisible = (opts: { root: string; path: string }): boolean => {
  const listed = spawnSync('git', ['status', '--porcelain', '--', opts.path], {
    cwd: opts.root,
    encoding: 'utf8',
    timeout: 5000,
  });

  return listed.status === 0 && listed.stdout.startsWith('?? ');
};

const mcpWarning = (opts: { file: string; message: string }): IViolation =>
  createViolation({ check: DoctorChecks.MCP, file: opts.file, message: opts.message });

const FMT_SECTION_ADVICE =
  'add a [fmt] section (printWidth = 100, singleQuote = true, arrowParens = "always", flavor = "oxfmt"): without it bun fmt formats with Bun\'s defaults, not the shared style';

const FMT_FLAVOR_ADVICE =
  'without it bun fmt uses its default style when oxfmt is not a dependency, and the output changes';

const OXFMT_LOADED_ADVICE =
  'bun fmt loads it and it overrides the [fmt] section of bunfig.toml - delete it, or move its settings to [fmt]';

/** The folders that can hold a package.json and an oxfmt config: the root, `packages/*` and every configured package. */
const formatOwners = (opts: ICheckContext): string[] => [
  ...new Set([
    '.',
    ...listDirectories({ directory: join(opts.root, 'packages') }).map((name) =>
      join('packages', name),
    ),
    ...ProjectPackages.resolve({ config: opts.config })
      .filter((entry) => !entry.retired)
      .map((entry) => relative(opts.root, join(opts.root, entry.path)) || '.'),
  ]),
];

export class ProjectContract {
  static checkLayout(opts: ICheckContext): IViolation[] {
    return ['AGENTS.md', '.agents/rules.md', opts.config.knowledge.bundle]
      .filter((path) => !existsSync(join(opts.root, path)))
      .map((path) =>
        createViolation({
          check: DoctorChecks.LAYOUT,
          file: path,
          message: `missing - run '${ProjectLayout.VULCAN_COMMAND} init'`,
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
      markdown: readText({ file: join(opts.root, '.agents', 'rules.md') }),
    })
      .filter((id) => base[id] === undefined)
      .map((id) => {
        const pack = RulePacks.holderOf({ id });

        return createViolation({
          check: DoctorChecks.RULE_IDS,
          file: '.agents/rules.md',
          message:
            pack === undefined
              ? `${id} is not a base rule - give the extension a bare ID`
              : `${id} is in the ${pack} pack - add '${pack}' to packs in the config`,
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

    for (const id of Object.keys(opts.config.rules).filter(
      (ruleId) => slots[ruleId] === undefined,
    )) {
      violations.push(
        createViolation({
          check: DoctorChecks.RULE_SLOTS,
          file: opts.configFile,
          message: `${id} is not a slot - only ${Object.keys(slots).join(', ')} take a choice`,
        }),
      );
    }

    return violations;
  }

  static checkSkills(opts: ICheckContext): IViolation[] {
    const shipped = new Set(listDirectories({ directory: join(BASE_DIRECTORY, 'skills') }));

    return listDirectories({ directory: join(opts.root, '.agents', 'skills') })
      .filter((name) => shipped.has(name))
      .map((name) =>
        createViolation({
          check: DoctorChecks.SKILLS,
          file: `.agents/skills/${name}`,
          message: `'${name}' is a shipped skill - rename the project skill, for example to '${ProjectManifest.projectNameOf({ root: opts.root, config: opts.config })}-${name}'`,
        }),
      );
  }

  static checkMake(opts: ICheckContext): IViolation[] {
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
      Makefile.parseMakeTargets({
        makefile: readText({ file: join(BASE_DIRECTORY, 'make', 'vulcan.mk') }),
      }),
    );

    for (const file of findProjectMakefiles({ root: opts.root })) {
      const targets = Makefile.parseMakeTargets({
        makefile: readText({ file: join(opts.root, file) }),
      });

      for (const target of targets.filter((name) => shipped.has(name))) {
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
  }

  static checkHooks(opts: ICheckContext): IViolation[] {
    return opts.config.hooks
      .filter((hook) => hook.command.includes(DoctorConstants.SHIPPED_HOOKS_PATH))
      .map((hook) =>
        createViolation({
          check: DoctorChecks.HOOKS,
          file: opts.configFile,
          message: `the ${hook.event} hook runs a shipped hook - sync registers those, never the project`,
        }),
      );
  }

  static checkAdapters(opts: ICheckContext): IViolation[] {
    const pending = SyncPlanner.plan({
      root: opts.root,
      config: opts.config,
      agents: AgentSelection.resolveQuietly({ root: opts.root, configAgents: opts.config.agents }),
    })
      .filter((action) => action.status !== SyncStatuses.UNCHANGED)
      .filter((action) => action.path !== join(opts.root, ManifestConstants.FILE));
    const absent = pending.filter((action) => action.status === SyncStatuses.CREATED);
    const differing = pending.filter((action) => action.status !== SyncStatuses.CREATED);

    // A clean checkout has none of the gitignored adapters: say so once, with the fix, not once per file.
    const violations =
      absent.length === 0
        ? []
        : [
            createViolation({
              check: DoctorChecks.ADAPTERS,
              file: relative(opts.root, absent[0].path),
              message: `not synced yet - run '${ProjectLayout.VULCAN_COMMAND} sync' (make vulcan-sync) first`,
            }),
          ];

    return [
      ...violations,
      ...differing.map((action) =>
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
  }

  /**
   * C1: the committed manifest is what the config renders - atlas reads the file, never the config.
   * A hand-edited one, or one without the `$generated` note, is not.
   */
  static checkManifest(opts: ICheckContext): IViolation[] {
    const action = SyncPlanner.planManifest({ root: opts.root, config: opts.config });

    if (action.status === SyncStatuses.UNCHANGED) {
      return [];
    }

    const fix = `run '${ProjectLayout.VULCAN_COMMAND} sync' and commit it`;

    return [
      createViolation({
        check: DoctorChecks.MANIFEST,
        file: ManifestConstants.FILE,
        message:
          action.status === SyncStatuses.CREATED
            ? `missing - ${fix}`
            : `stale against the config, or edited by hand - the manifest is generated, never edit it: edit .configs/vulcan.config.* and ${fix}`,
      }),
    ];
  }

  /**
   * D9: the shared coding style - every lint config builds on it, and the package whose `.configs/`
   * holds the config declares it, or the root does. A project with no lint config declares it at the
   * root. Owners are `packages/*` and every configured package's `path`, such as `backends/kit`.
   */
  static checkStyle(opts: ICheckContext): IViolation[] {
    const violations: IViolation[] = [];
    const owners = [
      ...new Set([
        '.',
        ...listDirectories({ directory: join(opts.root, 'packages') }).map((name) =>
          join('packages', name),
        ),
        ...ProjectPackages.resolve({ config: opts.config }).map(
          (entry) => relative(opts.root, join(opts.root, entry.path)) || '.',
        ),
      ]),
    ];
    const isRootDeclared = hasStylePackage({ directory: opts.root });
    let lintConfigs = 0;

    for (const owner of owners) {
      const configs = join(owner, '.configs');
      const directory = join(configs, DoctorConstants.LINT_CONFIG_FOLDER);
      const found = existsSync(join(opts.root, directory))
        ? readdirSync(join(opts.root, directory))
            .filter((file) => DoctorConstants.LINT_CONFIG_FILE.test(file))
            .map((file) => join(directory, file))
        : [];

      lintConfigs += found.length;

      if (
        found.length > 0 &&
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

      for (const file of found) {
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
  }

  /**
   * The scaffold is filled in: `init` writes a config and a knowledge index to be edited, and a
   * project that never did would otherwise pass. A workspaces project declares its packages, and the
   * knowledge index drops the scaffold marker once it describes the project.
   */
  static checkScaffold(opts: ICheckContext): IViolation[] {
    const violations: IViolation[] = [];

    if (
      ProjectScaffold.declaresWorkspaces({ root: opts.root }) &&
      ProjectPackages.resolve({ config: opts.config }).length === 0
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
  }

  /** Apps sit in the folders the user named, and every named folder is a workspace. */
  static checkApps(opts: ICheckContext): IViolation[] {
    const layout = opts.config.layout;

    if (layout === undefined) {
      return [];
    }

    const globs = ProjectScaffold.readWorkspaceGlobs({ root: opts.root });
    const folders = LayoutKeys.ALL.flatMap((key) =>
      LayoutFolder.layoutFoldersOf({ value: layout[key] }).map((folder) => ({ side: key, folder })),
    );
    // A folder under `other` is deliberately not managed: it need not be a workspace, only a package in it is allowed.
    const violations = folders
      .filter(
        ({ side, folder }) =>
          side !== LayoutKeys.OTHER && !ProjectScaffold.coversFolder({ globs, folder }),
      )
      .map(({ side, folder }) =>
        createViolation({
          check: DoctorChecks.APPS,
          file: 'package.json',
          message: `layout.${side} '${folder}' is not in package.json workspaces - add '${folder}/*'`,
        }),
      );
    const names = folders.map(({ folder }) => folder);
    // A package may be an `other` folder itself (a docs site at `docs`); a side folder only holds packages.
    const otherNames = folders
      .filter(({ side }) => side === LayoutKeys.OTHER)
      .map(({ folder }) => folder);

    for (const entry of ProjectPackages.resolve({ config: opts.config }).filter(
      (item) => !item.retired,
    )) {
      if (entry.kind === 'lib') {
        const parent = dirname(entry.path);

        // A library lives where the project keeps libraries; it only has to be a workspace.
        if (!ProjectScaffold.coversFolder({ globs, folder: parent })) {
          violations.push(
            createViolation({
              check: DoctorChecks.APPS,
              file: opts.configFile,
              message: `package ${entry.dir} lives at ${entry.path}, which no workspace glob covers - add '${parent}/*' to workspaces`,
            }),
          );
        }

        continue;
      }

      if (
        !names.some((folder) => entry.path.startsWith(`${folder}/`)) &&
        !otherNames.includes(entry.path)
      ) {
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
  }

  /** The developer's stored agents must parse and name known agents; a broken file would otherwise hide as a default. */
  static checkAgents(opts: ICheckContext): IViolation[] {
    const stored = LocalChoice.read({ root: opts.root });

    return stored.ok
      ? []
      : [
          createViolation({
            check: DoctorChecks.AGENTS,
            file: '.agents/vulcan.local.json',
            message: stored.error,
          }),
        ];
  }

  /**
   * The `commit-msg` hook of this clone, when the project turned a commit check on: a missing or out-of-date
   * one is fixed by `vulcan sync`; one that is not ours and does not call the check, or one a project with
   * `core.hooksPath` owns, is told the line to add. Per clone, so a warning and never a violation.
   */
  static checkCommitHook(opts: ICheckContext): IViolation[] {
    const status = CommitHook.stateOf({ root: opts.root, config: opts.config });
    const file = relative(opts.root, status.path);
    const fix = `run '${ProjectLayout.VULCAN_COMMAND} sync' (make vulcan-sync)`;

    switch (status.state) {
      case CommitHookStates.MISSING: {
        return [
          createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook is not installed, so commit messages are not checked - ${fix}`,
          }),
        ];
      }

      case CommitHookStates.STALE: {
        return [
          createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook is out of date - ${fix}`,
          }),
        ];
      }

      case CommitHookStates.UNWIRED: {
        return [
          createViolation({
            check: DoctorChecks.COMMIT_HOOK,
            file,
            message: `the commit-msg hook does not run the commit check - ${status.note ?? fix}`,
          }),
        ];
      }

      case CommitHookStates.OTHER_PROJECT: {
        return [
          createViolation({
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
   * `events.dir` names a folder outside the project: it must exist and be writable by this user, or the
   * event hooks lose every line without a word (they fail open). A folder inside the project is made
   * on the first write and is not checked. A warning: the folder belongs to the machine, not to the repository.
   */
  static checkEventsDir(opts: ICheckContext): IViolation[] {
    const { dir } = opts.config.events;

    if (dir === undefined) {
      return [];
    }

    const away = relative(opts.root, dir);

    if (away !== '' && !away.startsWith('..') && !isAbsolute(away)) {
      return [];
    }

    const problem = ((): string | undefined => {
      if (!existsSync(dir)) {
        return `does not exist - create it (mkdir -p ${dir})`;
      }

      if (!statSync(dir).isDirectory()) {
        return 'is not a folder';
      }

      try {
        accessSync(dir, constants.W_OK);

        return undefined;
      } catch {
        return 'is not writable by this user';
      }
    })();

    return problem === undefined
      ? []
      : [
          createViolation({
            check: DoctorChecks.EVENTS_DIR,
            file: opts.configFile,
            message: `events.dir ${dir} ${problem}, so the event log hooks cannot write there`,
          }),
        ];
  }

  /**
   * Today's file of the event log alone is bigger than `events.maxSize`. The retention never truncates a file and never
   * removes today's, so nothing else will shrink it: the project raises the limit or writes fewer lines. A warning.
   */
  static checkEventsSize(opts: ICheckContext): IViolation[] {
    const settings = { ...opts.config.events };

    if (!EventRetention.isActive({ settings })) {
      return [];
    }

    const dir = EventSettings.dirOf({ root: opts.root, settings });
    const limits = EventRetention.limitsOf({ settings });
    const plan = EventRetention.plan({ dir, limits, now: Date.now() });

    return plan.todayOver
      ? [
          createViolation({
            check: DoctorChecks.EVENTS_SIZE,
            file: opts.configFile,
            message: `today's event file in ${dir} is ${LocalFormat.formatBytes({ bytes: plan.todayBytes })}, over events.maxSize (${settings.maxSize ?? EventConstants.DEFAULT_MAX_SIZE}); nothing is truncated and today's file is never removed - raise maxSize or write fewer events`,
          }),
        ]
      : [];
  }

  /**
   * The atlas server is registered the one way every project does: the root `.mcp.json` (a per-machine
   * file `sync` writes for the agents that read it) holds an `atlas` entry that runs the project's own
   * atlas (`--root .`), and the managed Claude settings enable `atlas` by that name. A server under
   * another name, or one that serves another folder, is never enabled automatically or serves the wrong
   * knowledge. One that is untracked and not ignored is told how to hide it. Warnings, not violations.
   */
  static checkMcpAtlas(opts: ICheckContext): IViolation[] {
    const warnings: IViolation[] = [];
    const file = join(opts.root, MCP_FILE);
    const chosen = AgentSelection.resolveQuietly({
      root: opts.root,
      configAgents: opts.config.agents,
    });
    const readsMcpFile = AgentTable.read().some(
      (entry) => chosen.includes(entry.id) && entry.mcp.scope === AgentScopes.SHARED,
    );

    // The root `.mcp.json` is a per-machine file of the agents that read it; a missing one is the
    // `adapters` check's (not synced yet), so only an existing file is looked at.
    if (readsMcpFile && existsSync(file)) {
      if (isUntrackedAndVisible({ root: opts.root, path: MCP_FILE })) {
        warnings.push(
          mcpWarning({
            file: MCP_FILE,
            message:
              'untracked and not ignored, so a clean-tree check (a release) refuses to run. Add `/.mcp.json` to .gitignore, or run `vulcan sync` at the top level of the repository, which lists it in .git/info/exclude.',
          }),
        );
      }

      const parsed = readJsonObject({ file });

      if (parsed === undefined) {
        warnings.push(
          mcpWarning({
            file: MCP_FILE,
            message: `not valid JSON - it must hold ${MCP_SERVER_HINT} under mcpServers`,
          }),
        );
      } else {
        const holder = { value: parsed['mcpServers'] };
        const servers = RecordValue.isRecord(holder.value) ? holder.value : {};
        const entry = { value: servers[ATLAS_SERVER] };
        const args = RecordValue.isRecord(entry.value) ? entry.value['args'] : undefined;
        const isCanonical =
          RecordValue.isRecord(entry.value) &&
          entry.value['command'] === 'bun' &&
          Array.isArray(args) &&
          args.length === CANONICAL_ATLAS_ARGS.length &&
          args.every((arg, index) => arg === CANONICAL_ATLAS_ARGS[index]);

        if (!RecordValue.isRecord(entry.value)) {
          warnings.push(
            mcpWarning({
              file: MCP_FILE,
              message: `no server named atlas (found: ${Object.keys(servers).join(', ') || 'none'}): a differently named server is not enabled automatically - use ${MCP_SERVER_HINT}`,
            }),
          );
        } else if (!isCanonical) {
          const shown = JSON.stringify(entry.value)
            .replace('{"command":', '{ "command": ')
            .replace(',"args":[', ', "args": [')
            .replaceAll('","', '", "')
            .replace(/\]\}$/, '] }');

          warnings.push(
            mcpWarning({
              file: MCP_FILE,
              message: `the atlas entry is ${shown}, expected ${MCP_SERVER_HINT}`,
            }),
          );
        }
      }
    }

    const settings = join(opts.root, CLAUDE_SETTINGS_FILE);
    const enabled = existsSync(settings)
      ? readJsonObject({ file: settings })?.['enabledMcpjsonServers']
      : undefined;

    if (existsSync(settings) && !(Array.isArray(enabled) && enabled.includes(ATLAS_SERVER))) {
      const has = Array.isArray(enabled) ? enabled.map(String).join(', ') : 'none';

      warnings.push(
        mcpWarning({
          file: CLAUDE_SETTINGS_FILE,
          message: `enabledMcpjsonServers does not include atlas (has: ${has}): Claude asks before using the server - run vulcan sync`,
        }),
      );
    }

    return warnings;
  }

  /**
   * `bun fmt` reads the `[fmt]` section of `bunfig.toml`; without it, it formats with Bun's defaults
   * (width 80, double quotes) and rewrites a tree the shared style formatted, and without
   * `flavor = "oxfmt"` it formats like Prettier once oxfmt is not a dependency. A `fmt` script in a
   * `package.json` runs instead of the formatter, and an oxfmt config `bun fmt` finds by itself
   * overrides `[fmt]`; the `oxfmt.config.*` init used to write in `.configs/formatters/` is read by
   * nothing. Warnings, never failures: a project made before `bun fmt` does not start failing.
   */
  static checkFormat(opts: ICheckContext): IViolation[] {
    const warnings: IViolation[] = [];
    const bunfig = join(opts.root, 'bunfig.toml');
    const bunfigText = readText({ file: bunfig });

    if (!existsSync(bunfig)) {
      warnings.push(
        createViolation({
          check: DoctorChecks.FORMAT,
          file: 'bunfig.toml',
          message: `missing - ${FMT_SECTION_ADVICE}`,
        }),
      );
    } else if (!DoctorConstants.BUNFIG_FMT_SECTION.test(bunfigText)) {
      warnings.push(
        createViolation({
          check: DoctorChecks.FORMAT,
          file: 'bunfig.toml',
          message: `no [fmt] section - ${FMT_SECTION_ADVICE}`,
        }),
      );
    } else if (!DoctorConstants.BUNFIG_FMT_FLAVOR.test(bunfigText)) {
      warnings.push(
        createViolation({
          check: DoctorChecks.FORMAT,
          file: 'bunfig.toml',
          message: `[fmt] has no flavor = "oxfmt" - ${FMT_FLAVOR_ADVICE}`,
        }),
      );
    }

    for (const owner of formatOwners(opts)) {
      const manifest = join(owner, 'package.json');
      const formatters = join(owner, '.configs', 'formatters');

      if (readScriptNames({ file: join(opts.root, manifest) })?.includes('fmt')) {
        warnings.push(
          createViolation({
            check: DoctorChecks.FORMAT,
            file: manifest,
            message:
              'defines a "fmt" script: bun fmt runs it instead of formatting - rename it (the standard names are lint and lint:fix)',
          }),
        );
      }

      const copy = join(owner, 'bunfig.toml');

      if (
        owner !== '.' &&
        DoctorConstants.BUNFIG_FMT_SECTION.test(readText({ file: join(opts.root, copy) }))
      ) {
        warnings.push(
          createViolation({
            check: DoctorChecks.FORMAT,
            file: copy,
            message:
              'a [fmt] copy: bun fmt inherits the root bunfig.toml, and a copy here can drift from it - delete the section',
          }),
        );
      }

      for (const file of DoctorConstants.OXFMT_AUTOLOADED_FILES) {
        if (existsSync(join(opts.root, owner, file))) {
          warnings.push(
            createViolation({
              check: DoctorChecks.FORMAT,
              file: join(owner, file),
              message: OXFMT_LOADED_ADVICE,
            }),
          );
        }
      }

      if (existsSync(join(opts.root, formatters))) {
        for (const file of readdirSync(join(opts.root, formatters)).filter((name) =>
          DoctorConstants.OXFMT_CONFIG_FILE.test(name),
        )) {
          warnings.push(
            createViolation({
              check: DoctorChecks.FORMAT,
              file: join(formatters, file),
              message:
                'not used any more: bun fmt formats with the [fmt] section of bunfig.toml - delete it',
            }),
          );
        }
      }
    }

    return warnings;
  }

  /** Info only: the Atlas or rules block of AGENTS.md is missing or no longer matches the config. */
  static checkAtlasBlock(opts: ICheckContext): IViolation[] {
    const merged = AgentsBlockPlan.merged({ root: opts.root, config: opts.config });

    return merged === undefined || !merged.changed
      ? []
      : [
          createViolation({
            check: DoctorChecks.AGENTS,
            file: 'AGENTS.md',
            message: `the Atlas or rules block of AGENTS.md is missing or out of date - run '${ProjectLayout.VULCAN_COMMAND} sync'`,
          }),
        ];
  }

  /** A skill with no "Use when" part gives the atlas server's instructions nothing to say when to load it: a warning, never a failure. */
  static checkSkillTriggers(opts: ICheckContext): IViolation[] {
    return SkillCatalog.catalogOf({ root: opts.root })
      .filter((entry) => !SkillCatalog.triggerOf({ description: entry.description }).hasUseWhen)
      .map((entry) =>
        createViolation({
          check: DoctorChecks.SKILLS,
          file: entry.source === 'project' ? `.agents/skills/${entry.name}/SKILL.md` : entry.name,
          message: `'${entry.name}' has no "Use when" part in its description - atlas cannot say when to load it`,
        }),
      );
  }

  /** `.agents/local/` exists with its subdirectories and is gitignored: `sync` does both, so an upgraded project that has not synced yet is told here. */
  static checkLocalWorkspace(opts: ICheckContext): IViolation[] {
    return LocalPlan.planWorkspace({
      root: opts.root,
      tmp: ProjectTmp.configuredOf({ tmp: opts.config.local.tmp }),
    })
      .filter((action) => action.status !== SyncStatuses.UNCHANGED)
      .map((action) =>
        createViolation({
          check: DoctorChecks.LOCAL,
          file: relative(opts.root, action.path) || '.',
          message: `${action.note ?? 'out of date'} - run 'bun x --no-install vulcan sync'`,
        }),
      );
  }

  /** The personal profile: a file that cannot be read is named, and one git tracks is a personal file about to be shared. */
  static checkProfile(opts: ICheckContext): IViolation[] {
    const read = OwnerProfile.read({ root: opts.root });
    const violations: IViolation[] = [];

    if (!read.ok) {
      violations.push(
        createViolation({
          check: DoctorChecks.PROFILE,
          file: OwnerConstants.PROFILE_FILE,
          message: `${read.error} - fix it or delete it and run the profile form again`,
        }),
      );
    }

    if (
      existsSync(join(opts.root, OwnerConstants.PROFILE_FILE)) &&
      !OwnerProfile.profileIsIgnored({ root: opts.root })
    ) {
      violations.push(
        createViolation({
          check: DoctorChecks.PROFILE,
          file: OwnerConstants.PROFILE_FILE,
          message:
            'git does not ignore this personal file - add .agents/local/ to .gitignore (vulcan sync does it)',
        }),
      );
    }

    if (
      existsSync(join(opts.root, OwnerConstants.PROFILE_FILE)) &&
      AgentFiles.isTracked({ root: opts.root, path: OwnerConstants.PROFILE_FILE })
    ) {
      violations.push(
        createViolation({
          check: DoctorChecks.PROFILE,
          file: OwnerConstants.PROFILE_FILE,
          message:
            'git tracks this personal file - run: git rm --cached .agents/local/profile.json (and keep .agents/local/ in .gitignore)',
        }),
      );
    }

    return violations;
  }

  /**
   * What is directly under `.agents/local/` and is not a folder of the layout, a file VULCAN writes, or a browser's
   * scratch folder, in one warning: how many, how big, and their names. Nothing removes them.
   */
  static checkUnknownLocal(opts: ICheckContext): IViolation[] {
    const unknown = LocalScan.unknown({ root: opts.root });

    return unknown.length === 0
      ? []
      : [
          createViolation({
            check: DoctorChecks.LOCAL,
            file: ProjectLayout.LOCAL_DIRECTORY,
            message: `${unknown.length} ${unknown.length === 1 ? 'entry is' : 'entries are'} not ${unknown.length === 1 ? 'one' : 'ones'} VULCAN knows: ${unknown
              .slice(0, 10)
              .map((entry) => `${entry.name} (${LocalFormat.formatBytes({ bytes: entry.bytes })})`)
              .join(
                ', ',
              )}${unknown.length > 10 ? `, and ${unknown.length - 10} more` : ''}; put scratch in tmp/ and what you want to keep in reports/, what one agent keeps for itself in agents/<name>/; a script the team relies on belongs in the tracked tree (scripts/), where it gets review and history; nothing removes ${unknown.length === 1 ? 'it' : 'them'}`,
          }),
        ];
  }

  /**
   * What an agent left under `.agents/local/` that has outlived its use, in one warning: how many in each scope, how
   * big, and the command that clears them (which, without `--yes`, lists each one).
   */
  static checkStaleLocal(opts: ICheckContext): IViolation[] {
    const stale = LocalScan.scan({ root: opts.root }).filter((entry) =>
      [
        LocalStates.STALE,
        LocalStates.MERGED,
        LocalStates.GONE,
        LocalStates.ORPHAN,
        LocalStates.SHIPPED,
      ].includes(entry.state),
    );

    if (stale.length === 0) {
      return [];
    }

    const scopes = [...new Set(stale.map((entry) => entry.scope))];
    const counts = new Map<string, number>();

    for (const entry of stale) {
      const group = `${entry.state} in ${entry.scope}`;

      counts.set(group, (counts.get(group) ?? 0) + 1);
    }

    const groups = [...counts.entries()];
    const bytes = stale.reduce((total, entry) => total + entry.bytes, 0);

    return [
      createViolation({
        check: DoctorChecks.LOCAL,
        file: ProjectLayout.LOCAL_DIRECTORY,
        message: `${stale.length} ${stale.length === 1 ? 'entry has' : 'entries have'} outlived ${stale.length === 1 ? 'its' : 'their'} use (${LocalFormat.formatBytes({ bytes })}): ${groups.map(([group, count]) => `${count} ${group}`).join(', ')}; run: vulcan clean ${scopes.map((scope) => `--${scope}`).join(' ')} --yes (without --yes it lists each one)`,
      }),
    ];
  }

  /** The owner cards are off for this shell (`VULCAN_OWNER_REPLY=off`): a session an agent starts sets it, an owner who exported it by mistake sees why the rules carry no shape card; a note, never a failure. */
  static checkOwnerReplySwitch(opts: { env: Record<string, string | undefined> }): IViolation[] {
    return ReplySwitch.isOwnerOff({ env: opts.env })
      ? [
          createViolation({
            check: DoctorChecks.LOCAL,
            file: OwnerReplySwitch.ENV,
            message: `set to ${OwnerReplySwitch.OFF} in this shell: a session started from here gets no owner shape card and no profile card in its rules. Unset it for a session whose reader is the owner`,
          }),
        ]
      : [];
  }

  /**
   * What `local.tmp` must hold for `clean` and the hooks to be safe with it, and for a browser to start: it is not a folder
   * of the `layout` (or inside one) and holds no tracked file, because `clean` removes what is old in it; and its browser
   * socket path fits, so the key does what it exists for. Each is a failure here, not a surprise later. A project that does
   * not set the key gets the warning of `checkBrowserSocket`.
   */
  static checkTmpFolder(opts: ICheckContext): IViolation[] {
    const { tmp } = opts.config.local;

    if (tmp === undefined) {
      return [];
    }

    const folder = ProjectTmp.projectOf({ root: resolve(opts.root), tmp });
    const layoutFolders = Object.values(opts.config.layout ?? {}).flatMap((value) =>
      LayoutFolder.layoutFoldersOf({ value }),
    );
    const clash = layoutFolders.find(
      (entry) => entry === tmp || entry.startsWith(`${tmp}/`) || tmp.startsWith(`${entry}/`),
    );
    const tracked = spawnSync('git', ['ls-files', '--', tmp], {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: 5000,
    });
    const hasTracked = tracked.status === 0 && tracked.stdout.trim() !== '';
    const length = BrowserSocket.lengthOf({ folder });
    const problems = [
      ...(clash === undefined
        ? []
        : [`it is, or holds, the layout folder '${clash}': \`clean\` removes old files from it`]),
      ...(hasTracked
        ? [
            `git tracks files in it: \`clean\` removes old files from it. Pick a folder that only holds scratch`,
          ]
        : []),
      ...(BrowserSocket.fits({ folder })
        ? []
        : [
            `its socket path for a browser would be ${length} characters in ${folder} and the limit is ${BrowserSocket.PATH_MAX}. Use a shorter folder name or a shorter checkout path`,
          ]),
    ];

    return problems.map((problem) =>
      createViolation({
        check: DoctorChecks.LOCAL,
        file: opts.configFile,
        message: `local.tmp '${tmp}': ${problem}`,
      }),
    );
  }

  /**
   * The project's tmp folder is too deep for a browser: Chrome and Chromium put a socket below the temp folder
   * and exit with "Socket path too long" past the limit of a unix socket path (`BrowserSocket.PATH_MAX`, the Linux
   * value; macOS allows 104). The launch file points a session's `TMPDIR` at that folder, so a browser it starts
   * (Playwright MCP, a headless Chrome) fails; a project with no launch file is not asked. A warning, because only a
   * project that starts a browser meets it; the way out is a shorter checkout path. The root is made absolute first.
   */
  static checkBrowserSocket(opts: { root: string; tmp?: string }): IViolation[] {
    if (opts.tmp !== undefined) {
      return [];
    }

    const root = resolve(opts.root);
    const folder = ProjectTmp.projectOf({ root, tmp: HookConstants.PROJECT_TMP });
    const length = BrowserSocket.lengthOf({ folder });

    if (BrowserSocket.fits({ folder }) || !existsSync(join(root, CLAUDE_LAUNCH_FILE))) {
      return [];
    }

    const spare = BrowserSocket.PATH_MAX - (length - root.length);

    return [
      createViolation({
        check: DoctorChecks.LOCAL,
        file: CLAUDE_LAUNCH_FILE,
        message: `the temp folder ${folder} is too deep for a browser: Chrome's socket path would be ${length} characters (${BrowserSocket.longest()} below it) and the limit is ${BrowserSocket.PATH_MAX}, so a browser started with this folder exits with "${BrowserSocket.ERROR}". Set \`local.tmp\` in the config to a short folder of the project (for example \`tmp\`) and run \`vulcan sync\`, or move the checkout to a path of ${spare} characters or fewer`,
      }),
    ];
  }

  /**
   * The event log is on and the project has no `project.key`: flows cannot be created, because a flow is named
   * `VULZ-<key>-<number>`. A warning: the log still takes lines of flows made before.
   */
  static checkProjectKey(opts: ICheckContext): IViolation[] {
    return opts.config.events.log && opts.config.project === undefined
      ? [
          createViolation({
            check: DoctorChecks.PROJECT_KEY,
            file: opts.configFile,
            message: `the event log is on and project.key is not set, so no flow can be created: add project: { key: 'KEY' } (${ProjectKey.MESSAGE}), then run vulcan sync`,
          }),
        ]
      : [];
  }

  /** A Claude Code settings file of the project sets `VULCAN_OWNER_REPLY=off` in `env`: every session of the project then gets no owner shape card. A warning, never a failure. */
  static checkOwnerReplySettings(opts: { root: string }): IViolation[] {
    return ['.claude/settings.json', '.claude/settings.local.json'].flatMap((file) => {
      const env = readJsonObject({ file: join(opts.root, file) })?.['env'];

      return typeof env === 'object' &&
        env !== null &&
        Reflect.get(env, OwnerReplySwitch.ENV) === OwnerReplySwitch.OFF
        ? [
            createViolation({
              check: DoctorChecks.LOCAL,
              file,
              message: `env sets ${OwnerReplySwitch.ENV}=${OwnerReplySwitch.OFF}: every session of this project gets no owner shape card and no profile card. Remove it and set the variable on the command that starts a session whose reader is an agent`,
            }),
          ]
        : [];
    });
  }

  /**
   * Private values in committed files, never the text: one warning per file that holds a key, a token or a URL
   * credential, with the kinds and counts; the files that hold only addresses or machine paths (an example IP in a
   * policy file, a path in a doc) in one warning; and one per acknowledgment that covered nothing.
   */
  static checkPrivateValues(opts: ICheckContext): IViolation[] {
    const { findings, unmatched } = PrivateValues.scan({
      root: opts.root,
      acknowledged: opts.config.doctor.privateValues.acknowledged,
    });
    const where = 'doctor.privateValues.acknowledged';
    const kindsOf = (counts: Record<string, number | undefined>): string =>
      Object.entries(counts)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ');
    const isMild = (finding: { counts: Record<string, number | undefined> }): boolean =>
      Object.keys(finding.counts).every((kind) =>
        [PrivateValueKinds.IPV4, PrivateValueKinds.MACHINE_PATH].includes(kind),
      );
    const mild = findings.filter((finding) => isMild(finding));

    return [
      ...findings
        .filter((finding) => !isMild(finding))
        .map((finding) =>
          createViolation({
            check: DoctorChecks.PRIVATE_VALUES,
            file: finding.file,
            message: `holds private values: ${kindsOf(finding.counts)} (not shown); remove them, or record the decision in ${where}`,
          }),
        ),
      ...(mild.length === 0
        ? []
        : [
            createViolation({
              check: DoctorChecks.PRIVATE_VALUES,
              file: mild.length === 1 ? mild[0].file : `${mild.length} files`,
              message: `${mild.length === 1 ? 'holds' : `${mild.length} files hold`} only addresses or machine paths: ${mild.map((finding) => `${finding.file} (${kindsOf(finding.counts)})`).join(', ')} (not shown); remove them, or record the decision in ${where}`,
            }),
          ]),
      ...unmatched.map((entry) =>
        createViolation({
          check: DoctorChecks.PRIVATE_VALUES,
          file: opts.configFile,
          message: `${where}: "${entry.path}"${entry.kinds === undefined ? '' : ` (${entry.kinds.join(', ')})`} matches no file that holds such a value: remove the entry, or it covers files added later`,
        }),
      ),
    ];
  }

  /** What the project acknowledged, in one note: how many files hold values it decided to keep. It scans only when something is acknowledged. */
  static checkAcknowledgedValues(opts: ICheckContext): IViolation[] {
    const acknowledged = opts.config.doctor.privateValues.acknowledged;
    const { acknowledgedFiles } =
      acknowledged.length === 0
        ? { acknowledgedFiles: 0 }
        : PrivateValues.scan({ root: opts.root, acknowledged });

    return acknowledgedFiles === 0
      ? []
      : [
          createViolation({
            check: DoctorChecks.PRIVATE_VALUES,
            file: opts.configFile,
            message: `${acknowledgedFiles} ${acknowledgedFiles === 1 ? 'file' : 'files'} acknowledged in doctor.privateValues.acknowledged`,
          }),
        ];
  }
}
