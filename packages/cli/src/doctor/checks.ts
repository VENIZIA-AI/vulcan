import { Glob } from 'bun';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import { LayoutKeys, layoutFoldersOf } from '../common/layout-folder.ts';
import {
  coversFolder,
  declaresWorkspaces,
  MCP_SERVER_HINT,
  readWorkspaceGlobs,
} from '../init/index.ts';
import { resolvePackages } from '../config/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import {
  parseBaseReferences,
  readBaseRules,
  readRetiredRuleIds,
  readSlots,
  RuleConstants,
} from '../rules/index.ts';
import {
  isManifestCurrent,
  ManifestConstants,
  projectNameOf,
  renderManifest,
} from '../manifest/index.ts';
import {
  AgentScopes,
  readAgentTable,
  readLocalChoice,
  resolveAgentsQuietly,
} from '../agents/index.ts';
import {
  isTracked,
  mergedAtlasBlock,
  planLocalWorkspace,
  planManifest,
  planPrune,
  planSync,
  SyncStatuses,
} from '../sync/index.ts';
import { formatAge, formatBytes, LocalConstants, LocalStates, scanLocal } from '../local/index.ts';
import {
  isOwnerReplyOff,
  OwnerConstants,
  OwnerReplySwitch,
  profileIsIgnored,
  readProfile,
  readViolationCounts,
  violationLogBytes,
  ViolationConstants,
} from '../owner/index.ts';
import { skillCatalogOf, triggerOf } from '@venizia/vulcan-atlas';
import { trustOf, TrustStates } from '../hooks/index.ts';
import { AppScripts, DoctorChecks, DoctorConstants } from './common/index.ts';
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
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

export const checkLayout = (opts: ICheckContext): IViolation[] =>
  ['AGENTS.md', '.agents/rules.md', opts.config.knowledge.bundle]
    .filter((path) => !existsSync(join(opts.root, path)))
    .map((path) =>
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
    .filter((id) => base[id] === undefined)
    .map((id) =>
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

  for (const id of Object.keys(opts.config.rules).filter((ruleId) => slots[ruleId] === undefined)) {
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
    .filter((name) => shipped.has(name))
    .map((name) =>
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

      pending.push(...matches.filter((match) => !match.split('/').includes('node_modules')));
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
};

export const checkHooks = (opts: ICheckContext): IViolation[] =>
  opts.config.hooks
    .filter((hook) => hook.command.includes(DoctorConstants.SHIPPED_HOOKS_PATH))
    .map((hook) =>
      createViolation({
        check: DoctorChecks.HOOKS,
        file: opts.configFile,
        message: `the ${hook.event} hook runs a shipped hook - sync registers those, never the project`,
      }),
    );

export const checkAdapters = (opts: ICheckContext): IViolation[] => {
  const pending = planSync({
    root: opts.root,
    config: opts.config,
    agents: resolveAgentsQuietly({ root: opts.root, configAgents: opts.config.agents }),
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
            message: `not synced yet - run '${ProjectLayout.VULCAN_COMMAND} sync' (make agent-setup) first`,
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
};

/** What `sync --prune` would remove: an old VULCAN or plugin-era hook command, a dead skill link. */
export const checkPrune = (opts: ICheckContext): IViolation[] =>
  planPrune({ root: opts.root }).map((action) =>
    createViolation({
      check: DoctorChecks.PRUNE,
      file: relative(opts.root, action.path),
      message: `${action.note ?? 'stale'} - run '${ProjectLayout.VULCAN_COMMAND} sync --prune'`,
    }),
  );

/**
 * C1: the committed manifest is what the config renders - atlas reads the file, never the config.
 * A file written before the `$generated` note existed is current; a hand-edited one is not.
 */
export const checkManifest = (opts: ICheckContext): IViolation[] => {
  const action = planManifest({ root: opts.root, config: opts.config });

  if (
    action.status === SyncStatuses.UNCHANGED ||
    (action.status === SyncStatuses.REPLACED &&
      isManifestCurrent({
        committed: readFileSync(join(opts.root, ManifestConstants.FILE), 'utf8'),
        rendered: renderManifest({ root: opts.root, config: opts.config }),
      }))
  ) {
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
      ...listDirectories({ directory: join(opts.root, 'packages') }).map((name) =>
        join('packages', name),
      ),
      ...resolvePackages({ config: opts.config }).map(
        (entry) => relative(opts.root, join(opts.root, entry.path)) || '.',
      ),
    ]),
  ];
  const isRootDeclared = hasStylePackage({ directory: opts.root });
  let lintConfigs = 0;

  for (const owner of owners) {
    const configs = join(owner, '.configs');
    const found = ['.', ...new Set(Object.values(DoctorConstants.LINT_CONFIG_FOLDERS))].flatMap(
      (folder) => {
        const directory = join(configs, folder);

        return existsSync(join(opts.root, directory))
          ? readdirSync(join(opts.root, directory))
              .filter((file) => DoctorConstants.LINT_CONFIG_FILE.test(file))
              .map((file) => ({ file: join(directory, file), name: file, legacy: folder === '.' }))
          : [];
      },
    );
    const names = found.map((item) => item.file);

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

    for (const item of found) {
      const { file } = item;

      if (item.legacy) {
        const tool = item.name.split('.')[0];

        violations.push(
          createViolation({
            check: DoctorChecks.STYLE,
            file,
            message: `move it to .configs/${DoctorConstants.LINT_CONFIG_FOLDERS[tool]}/${item.name}`,
          }),
        );
      }

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
  const folders = LayoutKeys.ALL.flatMap((key) =>
    layoutFoldersOf({ value: layout[key] }).map((folder) => ({ side: key, folder })),
  );
  // A folder under `other` is deliberately not managed: it need not be a workspace, only a package in it is allowed.
  const violations = folders
    .filter(({ side, folder }) => side !== LayoutKeys.OTHER && !coversFolder({ globs, folder }))
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

  for (const entry of resolvePackages({ config: opts.config }).filter((item) => !item.retired)) {
    if (entry.kind === 'lib') {
      const parent = dirname(entry.path);

      // A library lives where the project keeps libraries; it only has to be a workspace.
      if (!coversFolder({ globs, folder: parent })) {
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

/**
 * Info only, never a failure: an app that lacks a standard script or carries a legacy one gets one
 * line naming them. Apps are the live packages inside the backend and frontend folders.
 */
export const checkAppScripts = (opts: ICheckContext): IViolation[] => {
  const layout = opts.config.layout;

  if (layout === undefined) {
    return [];
  }

  const appFolders = [
    ...layoutFoldersOf({ value: layout.backend }),
    ...layoutFoldersOf({ value: layout.frontend }),
  ];
  const notes: IViolation[] = [];

  for (const entry of resolvePackages({ config: opts.config }).filter((item) => !item.retired)) {
    if (!appFolders.some((folder) => entry.path.startsWith(`${folder}/`))) {
      continue;
    }

    const file = `${entry.path}/package.json`;
    const names = readScriptNames({ file: join(opts.root, file) });

    if (names === undefined) {
      continue;
    }

    const missing = AppScripts.STANDARD.filter((name) => !names.includes(name));
    const legacy = AppScripts.LEGACY.filter((name) => names.includes(name));
    const parts = [
      ...(missing.length === 0 ? [] : [`missing ${missing.join(', ')}`]),
      ...(legacy.length === 0 ? [] : [`legacy ${legacy.join(', ')} (use the standard names)`]),
    ];

    if (parts.length > 0) {
      notes.push(
        createViolation({
          check: DoctorChecks.SCRIPTS,
          file,
          message: `app ${entry.dir}: ${parts.join('; ')}`,
        }),
      );
    }
  }

  return notes;
};

/** The developer's stored agents must parse and name known agents; a broken file would otherwise hide as a default. */
export const checkAgents = (opts: ICheckContext): IViolation[] => {
  const stored = readLocalChoice({ root: opts.root });

  return stored.ok
    ? []
    : [
        createViolation({
          check: DoctorChecks.AGENTS,
          file: '.agents/vulcan.local.json',
          message: stored.error,
        }),
      ];
};

/** Info only: the Atlas block of AGENTS.md is missing or no longer matches the config. */
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

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

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

/**
 * The atlas server is registered the one way every project does: the root `.mcp.json` (a per-machine
 * file `sync` writes for the agents that read it) holds an `atlas` entry that runs the project's own
 * atlas (`--root .`), and the managed Claude settings enable `atlas` by that name. A server under
 * another name, or one that serves another folder, is never enabled automatically or serves the wrong
 * knowledge. A `.mcp.json` git still tracks is told how to hand over to `sync`; one that is untracked and not ignored is told how to hide it. Warnings, not violations.
 */
export const checkMcpAtlas = (opts: ICheckContext): IViolation[] => {
  const warnings: IViolation[] = [];
  const file = join(opts.root, MCP_FILE);
  const chosen = resolveAgentsQuietly({ root: opts.root, configAgents: opts.config.agents });
  const readsMcpFile = readAgentTable().some(
    (entry) => chosen.includes(entry.id) && entry.mcp.scope === AgentScopes.SHARED,
  );

  // The root `.mcp.json` is a per-machine file of the agents that read it; a missing one is the
  // `adapters` check's (not synced yet), so only an existing file is looked at.
  if (readsMcpFile && existsSync(file)) {
    if (isTracked({ root: opts.root, path: MCP_FILE })) {
      warnings.push(
        mcpWarning({
          file: MCP_FILE,
          message:
            'tracked by git; VULCAN now writes it per machine. Run `git rm --cached .mcp.json` and let sync manage it.',
        }),
      );
    } else if (isUntrackedAndVisible({ root: opts.root, path: MCP_FILE })) {
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
      const servers = isRecord(holder) ? holder.value : {};
      const entry = { value: servers[ATLAS_SERVER] };
      const args = isRecord(entry) ? entry.value['args'] : undefined;
      const isCanonical =
        isRecord(entry) &&
        entry.value['command'] === 'bun' &&
        Array.isArray(args) &&
        args.length === CANONICAL_ATLAS_ARGS.length &&
        args.every((arg, index) => arg === CANONICAL_ATLAS_ARGS[index]);

      if (!isRecord(entry)) {
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
};

const DOCKERFILE = '.configs/builders/Dockerfile';

const SECRET_LINES = ['**/.env', '**/.env.*', '!**/.env.example'];
const ADD_SECRET_LINES = `add ${SECRET_LINES[0]}, ${SECRET_LINES[1]} and ${SECRET_LINES[2]} (in that order) to the root .dockerignore`;

/** Whether a `.dockerignore` pattern, as Docker reads it, names the file `opts.file` at any depth. */
const patternNames = (opts: { pattern: string; file: string }): boolean => {
  const bare = opts.pattern.replace(/^\*\*\//, '').replace(/^\//, '');

  return (
    bare === opts.file ||
    (bare.endsWith('*') && opts.file.startsWith(bare.slice(0, -1)) && bare.startsWith('.env'))
  );
};

/** Whether the last pattern that names `opts.file` excludes it: a later `!` line brings it back. */
const excludes = (opts: { lines: string[]; file: string }): boolean => {
  let excluded = false;

  for (const line of opts.lines) {
    const negated = line.startsWith('!');

    if (patternNames({ pattern: negated ? line.slice(1) : line, file: opts.file })) {
      excluded = !negated;
    }
  }

  return excluded;
};

/**
 * A Dockerfile is built from the project root. Without a root `.dockerignore` the context carries
 * node_modules, dist, .git and every `.env` (secrets that would land in an image layer a CI cache
 * can keep); with one that does not exclude `.env` and `.env.*` the secrets are still copied.
 * A warning, not a violation: the exit code is unchanged, so a project made before this check
 * does not start failing.
 */
export const checkDockerignore = (opts: ICheckContext): IViolation[] => {
  const file = join(opts.root, '.dockerignore');
  const lines = existsSync(file)
    ? readText({ file })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : undefined;

  if (
    lines !== undefined &&
    excludes({ lines, file: '.env' }) &&
    excludes({ lines, file: '.env.production' })
  ) {
    return [];
  }

  const apps = resolvePackages({ config: opts.config })
    .filter((entry) => !entry.retired && existsSync(join(opts.root, entry.path, DOCKERFILE)))
    .map((entry) => entry.dir);

  if (apps.length === 0) {
    return [];
  }

  const subject = apps.length === 1 ? `app ${apps[0]} has` : `apps ${apps.join(', ')} have`;

  return [
    createViolation({
      check: DoctorChecks.DOCKERIGNORE,
      file: '.dockerignore',
      message:
        lines === undefined
          ? `${subject} a Dockerfile and the root has no .dockerignore: the build context would carry node_modules, dist, .git and every .env file (secrets) - create it, then ${ADD_SECRET_LINES}`
          : `${subject} a Dockerfile and the root .dockerignore does not exclude .env files, which hold secrets and would land in the image layer: ${ADD_SECRET_LINES}`,
    }),
  ];
};

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
    ...resolvePackages({ config: opts.config })
      .filter((entry) => !entry.retired)
      .map((entry) => relative(opts.root, join(opts.root, entry.path)) || '.'),
  ]),
];

/**
 * `bun fmt` reads the `[fmt]` section of `bunfig.toml`; without it, it formats with Bun's defaults
 * (width 80, double quotes) and rewrites a tree the shared style formatted, and without
 * `flavor = "oxfmt"` it formats like Prettier once oxfmt is not a dependency. A `fmt` script in a
 * `package.json` runs instead of the formatter, and an oxfmt config `bun fmt` finds by itself
 * overrides `[fmt]`; the `oxfmt.config.*` init used to write in `.configs/formatters/` is read by
 * nothing. Warnings, never failures: a project made before `bun fmt` does not start failing.
 */
export const checkFormat = (opts: ICheckContext): IViolation[] => {
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
};

export const checkAtlasBlock = (opts: ICheckContext): IViolation[] => {
  const merged = mergedAtlasBlock({ root: opts.root, config: opts.config });

  return merged === undefined || !merged.changed
    ? []
    : [
        createViolation({
          check: DoctorChecks.AGENTS,
          file: 'AGENTS.md',
          message: `the Atlas block is missing or out of date - run '${ProjectLayout.VULCAN_COMMAND} sync'`,
        }),
      ];
};

/** A skill with no "Use when" part gives the atlas server's instructions nothing to say when to load it: a warning, never a failure. */
export const checkSkillTriggers = (opts: ICheckContext): IViolation[] =>
  skillCatalogOf({ root: opts.root })
    .filter((entry) => !triggerOf({ description: entry.description }).hasUseWhen)
    .map((entry) =>
      createViolation({
        check: DoctorChecks.SKILLS,
        file: entry.source === 'project' ? `.agents/skills/${entry.name}/SKILL.md` : entry.name,
        message: `'${entry.name}' has no "Use when" part in its description - atlas cannot say when to load it`,
      }),
    );

/** `.agents/local/` exists with its subdirectories and is gitignored: `sync` does both, so an upgraded project that has not synced yet is told here. */
export const checkLocalWorkspace = (opts: ICheckContext): IViolation[] =>
  planLocalWorkspace({ root: opts.root })
    .filter((action) => action.status !== SyncStatuses.UNCHANGED)
    .map((action) =>
      createViolation({
        check: DoctorChecks.LOCAL,
        file: relative(opts.root, action.path) || '.',
        message: `${action.note ?? 'out of date'} - run 'bun x --no-install vulcan sync'`,
      }),
    );

/**
 * A worktree of this repository that lives outside it: the repository's own `git worktree list` names it
 * (git metadata is inside the project), and the exact command moves it in. Nothing is moved or removed.
 */
export const checkOutsideWorktrees = (opts: ICheckContext): IViolation[] => {
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: opts.root,
    encoding: 'utf8',
    timeout: 5000,
  });

  if (listed.status !== 0) {
    return [];
  }

  const [boundary, ...linked] = listed.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));

  if (boundary === undefined) {
    return [];
  }

  const inside = (path: string): boolean => {
    const real = existsSync(path) ? realpathSync(path) : path;

    return real === boundary || real.startsWith(`${boundary}${sep}`);
  };

  return linked
    .filter((path) => !inside(path))
    .map((path) =>
      createViolation({
        check: DoctorChecks.LOCAL,
        file: path,
        message: `a git worktree outside the project - move it in: git worktree move '${path}' '${join(boundary, ProjectLayout.LOCAL_DIRECTORY, 'worktrees', basename(path))}'`,
      }),
    );
};

/** The personal profile: a file that cannot be read is named, and one git tracks is a personal file about to be shared. */
export const checkProfile = (opts: ICheckContext): IViolation[] => {
  const read = readProfile({ root: opts.root });
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
    !profileIsIgnored({ root: opts.root })
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
    isTracked({ root: opts.root, path: OwnerConstants.PROFILE_FILE })
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
};

/** What an agent left under `.agents/local/` that has outlived its use, one line each with the command that clears it. */
export const checkStaleLocal = (opts: ICheckContext): IViolation[] =>
  scanLocal({ root: opts.root })
    .filter((entry) =>
      [LocalStates.STALE, LocalStates.MERGED, LocalStates.GONE, LocalStates.ORPHAN].includes(
        entry.state,
      ),
    )
    .map((entry) =>
      createViolation({
        check: DoctorChecks.LOCAL,
        file: `${ProjectLayout.LOCAL_DIRECTORY}/${entry.scope}/${entry.name}`,
        message: `${entry.state === LocalStates.STALE ? `left ${formatAge({ ageMs: entry.ageMs })} ago` : entry.note} (${formatBytes({ bytes: entry.bytes })}) - run: vulcan clean --${entry.scope} --yes`,
      }),
    );

/** How often replies to the owner were flagged (the report shape, or a claim the turn did not back), from the log the Stop hook keeps; a note, never a failure. */
export const checkReplyShape = (opts: ICheckContext): IViolation[] => {
  const { byClass, replies, days } = readViolationCounts({ root: opts.root });

  if (replies === 0) {
    return [];
  }

  const parts = [...byClass.entries()]
    .sort((first, second) => second[1] - first[1])
    .map(([name, count]) => `${name} ${count}`);

  const isFull = violationLogBytes({ root: opts.root }) > ViolationConstants.LOG_MAX_BYTES;

  return [
    ...(isFull
      ? [
          createViolation({
            check: DoctorChecks.LOCAL,
            file: `${ProjectLayout.LOCAL_DIRECTORY}/${ViolationConstants.LOG_FILE}`,
            message: `the log is full (${formatBytes({ bytes: ViolationConstants.LOG_MAX_BYTES })}) and no longer grows; keep or delete it, and a new one starts`,
          }),
        ]
      : []),
    createViolation({
      check: DoctorChecks.LOCAL,
      file: `${ProjectLayout.LOCAL_DIRECTORY}/${ViolationConstants.LOG_FILE}`,
      message: `${replies} repl${replies === 1 ? 'y was' : 'ies were'} flagged on ${days} day${days === 1 ? '' : 's'} (${parts.join(', ')}); the retro skill turns a pattern into a check`,
    }),
  ];
};

/** The owner reply shape is off for this shell (`VULCAN_OWNER_REPLY=off`): a session an agent starts sets it, an owner who exported it by mistake sees why nothing is checked; a note, never a failure. */
export const checkOwnerReplySwitch = (opts: {
  env: Record<string, string | undefined>;
}): IViolation[] =>
  isOwnerReplyOff({ env: opts.env })
    ? [
        createViolation({
          check: DoctorChecks.LOCAL,
          file: OwnerReplySwitch.ENV,
          message: `set to ${OwnerReplySwitch.OFF} in this shell: a session started from here is not held to the owner reply shape and its replies are not logged. Unset it for a session whose reader is the owner`,
        }),
      ]
    : [];

/** A Claude Code settings file of the project sets `VULCAN_OWNER_REPLY=off` in `env`: every session of the project then skips the owner reply shape. A warning, never a failure. */
export const checkOwnerReplySettings = (opts: { root: string }): IViolation[] =>
  ['.claude/settings.json', '.claude/settings.local.json'].flatMap((file) => {
    const env = readJsonObject({ file: join(opts.root, file) })?.['env'];

    return typeof env === 'object' &&
      env !== null &&
      Reflect.get(env, OwnerReplySwitch.ENV) === OwnerReplySwitch.OFF
      ? [
          createViolation({
            check: DoctorChecks.LOCAL,
            file,
            message: `env sets ${OwnerReplySwitch.ENV}=${OwnerReplySwitch.OFF}: every session of this project skips the owner reply shape. Remove it and set the variable on the command that starts a session whose reader is an agent`,
          }),
        ]
      : [];
  });

/** The size of `.agents/local/` once it is large: where the space went, and the command that gives it back. */
/** The states of a listed script worth a warning: a typo or a script nobody committed. A modified one is normal work, so it is only a note. */
const STALE_TRUST_STATES = new Set<string>([
  TrustStates.MISSING,
  TrustStates.UNTRACKED,
  TrustStates.UNCOMMITTED,
  TrustStates.SYMLINK,
  TrustStates.UNKNOWN,
]);

/** One line per script in `guard.writes.trustedScripts` with what git says about it now (a note). */
export const checkTrustedScripts = (opts: ICheckContext): IViolation[] =>
  opts.config.guard.writes.trustedScripts.map((script) => {
    const trust = trustOf({ root: opts.root, script });

    return createViolation({
      check: DoctorChecks.GUARDS,
      file: script,
      message:
        trust.state === TrustStates.TRUSTED
          ? 'guard-writes does not read this script for mutating calls (guard.writes.trustedScripts); it is ' +
            trust.reason
          : `listed in guard.writes.trustedScripts, but guard-writes reads it like any script now: ${trust.reason}`,
    });
  });

/** A listed script that does not exist or is not committed: the exemption never applies (a warning). */
export const checkStaleTrustedScripts = (opts: ICheckContext): IViolation[] =>
  opts.config.guard.writes.trustedScripts.flatMap((script) => {
    const trust = trustOf({ root: opts.root, script });

    return STALE_TRUST_STATES.has(trust.state)
      ? [
          createViolation({
            check: DoctorChecks.GUARDS,
            file: script,
            message: `guard.writes.trustedScripts lists it, but it never takes effect: ${trust.reason}; fix the path, or commit the script`,
          }),
        ]
      : [];
  });

export const checkLocalSize = (opts: ICheckContext): IViolation[] => {
  const entries = scanLocal({ root: opts.root });
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);

  if (total < LocalConstants.NOTE_BYTES) {
    return [];
  }

  const byScope = new Map<string, number>();

  for (const entry of entries) {
    byScope.set(entry.scope, (byScope.get(entry.scope) ?? 0) + entry.bytes);
  }

  const parts = [...byScope.entries()]
    .sort((first, second) => second[1] - first[1])
    .map(([scope, bytes]) => `${scope} ${formatBytes({ bytes })}`);

  return [
    createViolation({
      check: DoctorChecks.LOCAL,
      file: ProjectLayout.LOCAL_DIRECTORY,
      message: `holds ${formatBytes({ bytes: total })} (${parts.join(', ')}); vulcan clean lists what an agent left and --yes removes it`,
    }),
  ];
};
