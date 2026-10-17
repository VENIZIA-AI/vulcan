import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { SyncConstants, SyncStatuses } from './common/index.ts';
import type { ISyncAction, TSettings } from './common/index.ts';

/** The directory every shipped hook lives in; a command that runs one is VULCAN's. */
const SHIPPED_HOOKS_PATH = '@venizia/vulcan/base/hooks/';

/**
 * A hook a project kept under its own `.agents/` - where plugin-era setups put theirs: the whole
 * command is `bun` or `node` on that file, from the project root. Any other shape - another
 * directory's `.agents/`, `$HOME`, a `cd` first - is a developer's own and never pruned.
 */
const AGENTS_HOOK =
  /^(?:bun|node)\s+(?:"?\$\{?CLAUDE_PROJECT_DIR\}?"?\/)?(\.agents\/[\w./-]+\.ts)\s*$/;

type THookEntries = Record<string, { hooks?: { command?: string }[] }[]>;

const readJson = (opts: { path: string }): TSettings | undefined => {
  if (!existsSync(opts.path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(opts.path, 'utf8'));
  } catch (error) {
    console.error(
      `[readJson] ${opts.path} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

const commandsOf = (opts: { settings: TSettings | undefined }): string[] =>
  Object.values((opts.settings?.hooks ?? {}) as THookEntries).flatMap(entries =>
    entries.flatMap(entry => (entry.hooks ?? []).flatMap(hook => hook.command ?? [])),
  );

/**
 * A command sync did not write that is known to be stale: a shipped hook in a form this VULCAN no
 * longer writes, or a `.agents/` hook whose file is gone. Any other command is a developer's own.
 */
const isStaleCommand = (opts: { root: string; command: string; shipped: Set<string> }): boolean => {
  if (opts.command.includes(SHIPPED_HOOKS_PATH)) {
    return !opts.shipped.has(opts.command);
  }

  const agentsHook = AGENTS_HOOK.exec(opts.command)?.[1];

  return agentsHook !== undefined && !existsSync(join(opts.root, agentsHook));
};

/** Takes one command out of the settings file; an entry or an event left empty goes with it. */
const removeHookCommand = (opts: { path: string; command: string }): void => {
  const settings = readJson({ path: opts.path });
  const hooks = (settings?.hooks ?? {}) as THookEntries;

  if (settings === undefined) {
    return;
  }

  for (const [event, entries] of Object.entries(hooks)) {
    const kept = entries
      .map(entry => ({
        ...entry,
        hooks: (entry.hooks ?? []).filter(hook => hook.command !== opts.command),
      }))
      .filter(entry => entry.hooks.length > 0);

    if (kept.length > 0) {
      hooks[event] = kept;
    } else {
      delete hooks[event];
    }
  }

  writeFileSync(opts.path, `${JSON.stringify(settings, null, 2)}\n`);
};

const isDeadLink = (opts: { path: string }): boolean => {
  try {
    return lstatSync(opts.path).isSymbolicLink() && !existsSync(opts.path);
  } catch {
    return false;
  }
};

/**
 * `sync --prune`: what sync can prove is stale and did not write itself - old VULCAN and plugin-era
 * hook commands, and skill links whose target is gone. What sync wrote last time it takes back on
 * every run; a developer's own hooks and any real directory are never touched.
 */
export const planPrune = (opts: { root: string }): ISyncAction[] => {
  const directory = join(opts.root, SyncConstants.CLAUDE_DIRECTORY);
  const settingsPath = join(directory, SyncConstants.SETTINGS_FILE);
  const managed = new Set(
    commandsOf({ settings: readJson({ path: join(directory, SyncConstants.MANAGED_FILE) }) }),
  );
  const shipped = new Set(
    commandsOf({
      settings: readJson({ path: join(BASE_DIRECTORY, 'claude', SyncConstants.SETTINGS_FILE) }),
    }),
  );
  const staleCommands = [
    ...new Set(commandsOf({ settings: readJson({ path: settingsPath }) })),
  ].filter(
    command => !managed.has(command) && isStaleCommand({ root: opts.root, command, shipped }),
  );
  const skills = join(directory, SyncConstants.SKILLS_DIRECTORY);
  const deadLinks = existsSync(skills)
    ? readdirSync(skills)
        .map(name => join(skills, name))
        .filter(path => isDeadLink({ path }))
    : [];

  return [
    ...staleCommands.map((command): ISyncAction => ({
      path: settingsPath,
      status: SyncStatuses.REMOVED,
      note: `stale hook: ${command}`,
      apply: () => removeHookCommand({ path: settingsPath, command }),
    })),
    ...deadLinks.map((path): ISyncAction => ({
      path,
      status: SyncStatuses.REMOVED,
      note: 'dead link',
      apply: () => rmSync(path),
    })),
  ];
};
