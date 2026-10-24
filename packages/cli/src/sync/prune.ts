import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { SyncConstants, SyncStatuses } from './common/index.ts';
import type { ISyncAction, TSettings } from './common/index.ts';
import { extractHookCommands, isSettingsObject, removeHookCommands } from './settings.ts';

/**
 * The exact hook commands released VULCAN versions shipped (0.1.0-x, then 0.2.0-0). Only these are
 * an old VULCAN form: a shipped hook a developer customised is theirs, and never pruned.
 */
const RETIRED_SHIPPED_COMMANDS = new Set([
  `bun "\${CLAUDE_PROJECT_DIR}"/node_modules/@venizia/vulcan/base/hooks/session-start.ts`,
  `bun "\${CLAUDE_PROJECT_DIR}"/node_modules/@venizia/vulcan/base/hooks/guard-writes.ts`,
  `f="\${CLAUDE_PROJECT_DIR}/node_modules/@venizia/vulcan/base/hooks/session-start.ts"; if [ -f "$f" ] && command -v bun >/dev/null 2>&1; then bun "$f"; s=$?; [ "$s" -eq 0 ] && exit 0; exit 2; fi; echo "vulcan: the session-start hook cannot run (node_modules/@venizia/vulcan or bun is missing) - run bun install" >&2; exit 2`,
  `f="\${CLAUDE_PROJECT_DIR}/node_modules/@venizia/vulcan/base/hooks/guard-writes.ts"; if [ -f "$f" ] && command -v bun >/dev/null 2>&1; then bun "$f"; s=$?; [ "$s" -eq 0 ] && exit 0; exit 2; fi; if grep -Eq '"command" *: *"bun (install|i)( --?[a-z][a-z0-9-]*(=[A-Za-z0-9._-]+)?)*"'; then exit 0; fi; echo "vulcan: the guard-writes hook cannot run (node_modules/@venizia/vulcan or bun is missing) - run bun install (the one command that passes until then)" >&2; exit 2`,
]);

/**
 * A hook a project kept under its own `.agents/` - where plugin-era setups put theirs: the whole
 * command is `bun` or `node` on that file, from the project root. Any other shape - another
 * directory's `.agents/`, `$HOME`, a `cd` first - is a developer's own and never pruned.
 */
const AGENTS_HOOK =
  /^(?:bun|node)\s+(?:"?\$\{?CLAUDE_PROJECT_DIR\}?"?\/)?(\.agents\/[\w./-]+\.ts)\s*$/;

const readJson = (opts: { path: string }): TSettings | undefined => {
  if (!existsSync(opts.path)) {
    return undefined;
  }

  try {
    const parsed = { value: JSON.parse(readFileSync(opts.path, 'utf8')) };

    return isSettingsObject(parsed) ? parsed.value : undefined;
  } catch (error) {
    console.error(
      `[readJson] ${opts.path} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

/**
 * A command sync did not write that is known to be stale: a shipped hook exactly as an older VULCAN
 * released it, or a `.agents/` hook whose file is gone. Any other command is a developer's own.
 */
const isStaleCommand = (opts: { root: string; command: string; shipped: Set<string> }): boolean => {
  if (RETIRED_SHIPPED_COMMANDS.has(opts.command)) {
    return !opts.shipped.has(opts.command);
  }

  const agentsHook = AGENTS_HOOK.exec(opts.command)?.[1];

  return agentsHook !== undefined && !existsSync(join(opts.root, agentsHook));
};

/** Takes one command out of the settings file; an entry or an event left empty goes with it. */
const removeHookCommand = (opts: { path: string; command: string }): void => {
  const settings = readJson({ path: opts.path });
  const hooks = { value: settings?.[SyncConstants.HOOKS_KEY] };

  if (settings === undefined || !isSettingsObject(hooks)) {
    return;
  }

  for (const [event, entries] of Object.entries(hooks.value)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    const kept = removeHookCommands({ entries, commands: new Set([opts.command]) });

    if (kept.length > 0) {
      hooks.value[event] = kept;
    } else {
      delete hooks.value[event];
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
    extractHookCommands({
      settings: readJson({ path: join(directory, SyncConstants.MANAGED_FILE) }),
    }),
  );
  const shipped = new Set(
    extractHookCommands({
      settings: readJson({ path: join(BASE_DIRECTORY, 'claude', SyncConstants.SETTINGS_FILE) }),
    }),
  );
  const staleCommands = [
    ...new Set(extractHookCommands({ settings: readJson({ path: settingsPath }) })),
  ].filter(
    (command) => !managed.has(command) && isStaleCommand({ root: opts.root, command, shipped }),
  );
  const skills = join(directory, SyncConstants.SKILLS_DIRECTORY);
  // lstat, not stat: a symlinked skills directory leads out of the project and is never walked.
  const deadLinks = lstatSync(skills, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(skills)
        .map((name) => join(skills, name))
        .filter((path) => isDeadLink({ path }))
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
