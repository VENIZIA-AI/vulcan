import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  AgentConstants,
  AgentGuardKinds,
  AgentRenderers,
  AgentScopes,
  readAgentTable,
  RemoveOutcomes,
  removeCodexBlock,
  removeCodexHooks,
  removeGuardHook,
  removeMcpEntry,
} from '../agents/index.ts';
import type { TAgentEntry } from '../agents/index.ts';
import { isTracked } from './agent-files.ts';
import { BASE_DIRECTORY, stableBaseDirectoryOf } from '../common/index.ts';
import { SyncConstants, SyncStatuses } from './common/index.ts';
import type { ISyncAction, TSettings } from './common/index.ts';
import { isSettingsObject, removeManagedSettings } from './settings.ts';

const NO_CHANGE = (): void => {};
const CLAUDE_SKILLS = join(SyncConstants.CLAUDE_DIRECTORY, SyncConstants.SKILLS_DIRECTORY);
/** Parents sync may delete once empty: its own agent folders, never `.agents` or the project. */
const OWN_FOLDERS = new Set(['.cursor', '.codex', '.pi', '.omp', '.vscode', '.claude']);

const isSymlink = (opts: { path: string }): boolean =>
  lstatSync(opts.path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

const removeIfEmpty = (opts: { path: string }): void => {
  try {
    if (existsSync(opts.path) && readdirSync(opts.path).length === 0) {
      rmdirSync(opts.path);
    }
  } catch {
    // A folder that cannot be removed stays; it is the user's to clean.
  }
};

const readJsonObject = (opts: { path: string }): TSettings | undefined => {
  try {
    const parsed = { value: JSON.parse(readFileSync(opts.path, 'utf8')) };

    return isSettingsObject(parsed) ? parsed.value : undefined;
  } catch {
    return undefined;
  }
};

/** A skill link sync made: a symlink into the shipped skills, stable or in the package, or into `.agents/skills`. */
const isSkillLink = (opts: { root: string; path: string }): boolean => {
  if (!isSymlink({ path: opts.path })) {
    return false;
  }

  const target = readlinkSync(opts.path);
  const shipped = [
    join(stableBaseDirectoryOf(opts), SyncConstants.SKILLS_DIRECTORY),
    join(BASE_DIRECTORY, SyncConstants.SKILLS_DIRECTORY),
    join(opts.root, '.agents', SyncConstants.SKILLS_DIRECTORY),
  ];

  return shipped.some((directory) => target === directory || target.startsWith(`${directory}/`));
};

const removeFile = (opts: { path: string; note?: string; parent?: string }): ISyncAction => ({
  path: opts.path,
  status: SyncStatuses.REMOVED,
  note: opts.note,
  apply: () => {
    rmSync(opts.path, { force: true });

    if (opts.parent !== undefined) {
      removeIfEmpty({ path: opts.parent });
    }
  },
});

/**
 * The root `.mcp.json`, once no remaining agent reads it: sync's own atlas entry is taken out (the file
 * goes when nothing else is in it). A file git tracks is the project's, and an entry the user changed
 * is theirs: both are left, and the line says so.
 */
const planSharedMcpRemoval = (opts: { root: string }): ISyncAction[] => {
  const path = join(opts.root, AgentConstants.SHARED_MCP_FILE);

  if (!existsSync(path)) {
    return [];
  }

  const removed = removeMcpEntry({ text: readFileSync(path, 'utf8'), key: 'mcpServers' });

  if (!removed.ok) {
    return [{ path, status: SyncStatuses.SKIPPED, note: removed.reason, apply: NO_CHANGE }];
  }

  if (removed.outcome === RemoveOutcomes.ABSENT) {
    return [];
  }

  if (isTracked({ root: opts.root, path: AgentConstants.SHARED_MCP_FILE })) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: 'tracked by git - left alone',
        apply: NO_CHANGE,
      },
    ];
  }

  return removed.text === undefined
    ? [removeFile({ path })]
    : [
        {
          path,
          status: SyncStatuses.REPLACED,
          note: 'the atlas entry taken out',
          apply: () => writeFileSync(path, removed.text ?? ''),
        },
      ];
};

/** VULCAN's entry taken out of a hooks file; the file goes when nothing else is in it. */
const planGuardHookRemoval = (opts: {
  root: string;
  path: string;
  relative: string;
  kind: string;
}): ISyncAction[] => {
  if (!existsSync(opts.path)) {
    return [];
  }

  const text = readFileSync(opts.path, 'utf8');
  const removed =
    opts.kind === AgentGuardKinds.CODEX_HOOKS
      ? removeCodexHooks({ text })
      : removeGuardHook({ text });
  const folder = dirname(opts.path);
  const parent = OWN_FOLDERS.has(basename(folder)) ? folder : undefined;

  if (!removed.ok) {
    return [
      { path: opts.path, status: SyncStatuses.SKIPPED, note: removed.reason, apply: NO_CHANGE },
    ];
  }

  if (removed.outcome === RemoveOutcomes.ABSENT) {
    return [];
  }

  if (isTracked({ root: opts.root, path: opts.relative })) {
    return [
      {
        path: opts.path,
        status: SyncStatuses.SKIPPED,
        note: 'tracked by git - left alone',
        apply: NO_CHANGE,
      },
    ];
  }

  return removed.text === undefined
    ? [removeFile({ path: opts.path, parent })]
    : [
        {
          path: opts.path,
          status: SyncStatuses.REPLACED,
          note: 'the VULCAN guard hook taken out',
          apply: () => writeFileSync(opts.path, removed.text ?? ''),
        },
      ];
};

/** The guard extension sync wrote, taken back with its folders once they are empty; a file of the user's stays. */
const planGuardsRemoval = (opts: { root: string; entry: TAgentEntry }): ISyncAction[] => {
  if (opts.entry.guards === null) {
    return [];
  }

  const path = join(opts.root, opts.entry.guards.path);

  if (
    opts.entry.guards.kind === AgentGuardKinds.HOOKS_JSON ||
    opts.entry.guards.kind === AgentGuardKinds.CODEX_HOOKS
  ) {
    return planGuardHookRemoval({
      root: opts.root,
      path,
      relative: opts.entry.guards.path,
      kind: opts.entry.guards.kind,
    });
  }

  if (
    !existsSync(path) ||
    !readFileSync(path, 'utf8').startsWith(AgentConstants.GUARD_EXTENSION_MARKER)
  ) {
    return [];
  }

  if (isTracked({ root: opts.root, path: opts.entry.guards.path })) {
    return [
      { path, status: SyncStatuses.SKIPPED, note: 'tracked by git - left alone', apply: NO_CHANGE },
    ];
  }

  return [
    {
      path,
      status: SyncStatuses.REMOVED,
      apply: () => {
        rmSync(path, { force: true });

        // The folders the file sat in, innermost first, up to and including the agent's own folder.
        let directory = dirname(path);

        while (directory.startsWith(`${opts.root}/`)) {
          removeIfEmpty({ path: directory });

          if (OWN_FOLDERS.has(basename(directory))) {
            break;
          }

          directory = dirname(directory);
        }
      },
    },
  ];
};

const planMcpRemoval = (opts: { root: string; entry: TAgentEntry }): ISyncAction[] => {
  if (opts.entry.mcp.scope !== AgentScopes.PROJECT) {
    return [];
  }

  const path = join(opts.root, opts.entry.mcp.path);

  if (!existsSync(path)) {
    return [];
  }

  const text = readFileSync(path, 'utf8');
  const folder = dirname(opts.entry.mcp.path);
  const parent = OWN_FOLDERS.has(folder) ? join(opts.root, folder) : undefined;

  if (opts.entry.mcp.renderer === AgentRenderers.CODEX_TOML) {
    const removed = removeCodexBlock({ text });

    if (!removed.changed) {
      return [];
    }

    return removed.text === undefined
      ? [removeFile({ path, parent })]
      : [
          {
            path,
            status: SyncStatuses.REPLACED,
            note: 'the atlas block taken out',
            apply: () => writeFileSync(path, removed.text ?? ''),
          },
        ];
  }

  const key = opts.entry.mcp.renderer === AgentRenderers.SERVERS ? 'servers' : 'mcpServers';
  const removed = removeMcpEntry({ text, key });

  if (!removed.ok) {
    return [{ path, status: SyncStatuses.SKIPPED, note: removed.reason, apply: NO_CHANGE }];
  }

  if (removed.outcome === RemoveOutcomes.ABSENT) {
    return [];
  }

  return removed.text === undefined
    ? [removeFile({ path, parent })]
    : [
        {
          path,
          status: SyncStatuses.REPLACED,
          note: 'the atlas entry taken out',
          apply: () => writeFileSync(path, removed.text ?? ''),
        },
      ];
};

const planSkillLinkRemoval = (opts: { root: string; directory: string }): ISyncAction[] => {
  const target = join(opts.root, opts.directory);

  if (!existsSync(target) || isSymlink({ path: target })) {
    return [];
  }

  const links = readdirSync(target)
    .map((name) => join(target, name))
    .filter((path) => isSkillLink({ root: opts.root, path }));

  return links.map((path, index) => ({
    path,
    status: SyncStatuses.REMOVED,
    apply: () => {
      rmSync(path, { force: true });

      if (index === links.length - 1) {
        removeIfEmpty({ path: target });
        removeIfEmpty({
          path: dirname(target) === join(opts.root, '.agents') ? '' : dirname(target),
        });
      }
    },
  }));
};

const planClaudeRemoval = (opts: { root: string }): ISyncAction[] => {
  const actions: ISyncAction[] = [];
  const shim = join(opts.root, SyncConstants.CLAUDE_TOOL_FILE);

  if (existsSync(shim) && readFileSync(shim, 'utf8').trim() === SyncConstants.CLAUDE_IMPORT_LINE) {
    actions.push(removeFile({ path: shim }));
  }

  const directory = join(opts.root, SyncConstants.CLAUDE_DIRECTORY);
  const settingsPath = join(directory, SyncConstants.SETTINGS_FILE);
  const managedPath = join(directory, SyncConstants.MANAGED_FILE);
  const settings = readJsonObject({ path: settingsPath });
  const managed = readJsonObject({ path: managedPath });

  if (settings !== undefined && managed !== undefined) {
    const remaining = removeManagedSettings({ settings, managed });

    actions.push(
      Object.keys(remaining).length === 0
        ? removeFile({ path: settingsPath, note: 'only what sync wrote was in it' })
        : {
            path: settingsPath,
            status: SyncStatuses.REPLACED,
            note: 'the settings sync wrote taken out, yours kept',
            apply: () => writeFileSync(settingsPath, `${JSON.stringify(remaining, null, 2)}\n`),
          },
    );
  }

  if (existsSync(managedPath)) {
    actions.push(removeFile({ path: managedPath }));
  }

  actions.push(...planSkillLinkRemoval({ root: opts.root, directory: CLAUDE_SKILLS }));

  return actions;
};

/**
 * What sync created for the agents that are no longer chosen, taken back: the Claude shim and managed
 * settings, a file sync wrote whole, the atlas key it merged into a file that holds more, the Codex
 * block, and the skill links no remaining agent still reads. A file the user changed so the entry is
 * no longer sync's is left and reported.
 */
export const planAgentRemoval = (opts: {
  root: string;
  removed: string[];
  remaining: string[];
}): ISyncAction[] => {
  const table = readAgentTable();
  const kept = new Set(
    table.filter((entry) => opts.remaining.includes(entry.id)).map((entry) => entry.skills.dir),
  );
  const cleaned = new Set<string>();
  const actions: ISyncAction[] = [];
  const stillReadsShared = table.some(
    (entry) => opts.remaining.includes(entry.id) && entry.mcp.scope === AgentScopes.SHARED,
  );
  let sharedDone = false;

  for (const entry of table.filter((item) => opts.removed.includes(item.id))) {
    if (entry.id === AgentConstants.DEFAULT_AGENT) {
      actions.push(...planClaudeRemoval({ root: opts.root }));
    }

    actions.push(...planMcpRemoval({ root: opts.root, entry }));
    actions.push(...planGuardsRemoval({ root: opts.root, entry }));

    if (entry.mcp.scope === AgentScopes.SHARED && !stillReadsShared && !sharedDone) {
      sharedDone = true;
      actions.push(...planSharedMcpRemoval({ root: opts.root }));
    }

    if (
      entry.skills.dir !== CLAUDE_SKILLS &&
      !kept.has(entry.skills.dir) &&
      !cleaned.has(entry.skills.dir)
    ) {
      cleaned.add(entry.skills.dir);
      actions.push(...planSkillLinkRemoval({ root: opts.root, directory: entry.skills.dir }));
    }
  }

  return actions;
};
