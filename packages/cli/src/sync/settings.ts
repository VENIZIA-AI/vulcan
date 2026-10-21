import type { TResolvedConfig } from '../config/index.ts';
import { SyncConstants } from './common/index.ts';
import type { TSettings } from './common/index.ts';

export const isSettingsObject = (opts: { value: unknown }): opts is { value: TSettings } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** Arrays concatenate without duplicates, so a second sync adds nothing. */
const mergeArrays = (opts: { base: unknown[]; overlay: unknown[] }): unknown[] => {
  const seen = new Set(opts.base.map(entry => JSON.stringify(entry)));

  return [...opts.base, ...opts.overlay.filter(entry => !seen.has(JSON.stringify(entry)))];
};

/** `overlay` wins key by key; one level deep into the object-of-entries keys (SyncConstants.MERGE_ONE_LEVEL). */
export const mergeSettings = (opts: { base: TSettings; overlay: TSettings }): TSettings => {
  const merged: TSettings = { ...opts.base };

  for (const [key, value] of Object.entries(opts.overlay)) {
    const current = { value: merged[key] };
    const incoming = { value };

    if (
      SyncConstants.UNION_ARRAYS.has(key) &&
      Array.isArray(current.value) &&
      Array.isArray(value)
    ) {
      merged[key] = mergeArrays({ base: current.value, overlay: value });
      continue;
    }

    if (
      !SyncConstants.MERGE_ONE_LEVEL.has(key) ||
      !isSettingsObject(current) ||
      !isSettingsObject(incoming)
    ) {
      merged[key] = value;
      continue;
    }

    const inner: TSettings = { ...current.value };

    for (const [innerKey, innerValue] of Object.entries(incoming.value)) {
      const existing = inner[innerKey];

      inner[innerKey] =
        Array.isArray(existing) && Array.isArray(innerValue)
          ? mergeArrays({ base: existing, overlay: innerValue })
          : innerValue;
    }

    merged[key] = inner;
  }

  return merged;
};

const toKey = (opts: { value: unknown }): string => JSON.stringify(opts.value);

/** The command of a hook; `undefined` when `hook` is not an object with a command string. */
const toHookCommand = (opts: { hook: unknown }): string | undefined => {
  const hook = { value: opts.hook };

  return isSettingsObject(hook) && typeof hook.value.command === 'string'
    ? hook.value.command
    : undefined;
};

/** A hook entry and its hooks; `undefined` when `entry` is not an object with a `hooks` array. */
const toHookEntry = (opts: {
  entry: unknown;
}): { entry: TSettings; hooks: unknown[] } | undefined => {
  const entry = { value: opts.entry };

  return isSettingsObject(entry) && Array.isArray(entry.value.hooks)
    ? { entry: entry.value, hooks: entry.value.hooks }
    : undefined;
};

/** Every hook command in one event's entries; anything that is not an entry or a command is skipped. */
export const extractEntryCommands = (opts: { entries: unknown }): string[] =>
  Array.isArray(opts.entries)
    ? opts.entries.flatMap(entry =>
        (toHookEntry({ entry })?.hooks ?? []).flatMap(hook => toHookCommand({ hook }) ?? []),
      )
    : [];

/** Every hook command of a settings file, across its events. */
export const extractHookCommands = (opts: { settings: TSettings | undefined }): string[] => {
  const hooks = { value: opts.settings?.[SyncConstants.HOOKS_KEY] };

  return isSettingsObject(hooks)
    ? Object.values(hooks.value).flatMap(entries => extractEntryCommands({ entries }))
    : [];
};

/**
 * `entries` without the hooks whose command is in `commands`: an entry's other hooks and keys stay,
 * an entry left with no hooks goes, and anything that is not an entry is kept as it is.
 */
export const removeHookCommands = (opts: {
  entries: unknown[];
  commands: Set<string>;
}): unknown[] =>
  opts.entries.flatMap(entry => {
    const hookEntry = toHookEntry({ entry });

    if (hookEntry === undefined) {
      return [entry];
    }

    const kept = hookEntry.hooks.filter(hook => {
      const command = toHookCommand({ hook });

      return command === undefined || !opts.commands.has(command);
    });

    if (kept.length === hookEntry.hooks.length) {
      return [entry];
    }

    return kept.length > 0 ? [{ ...hookEntry.entry, hooks: kept }] : [];
  });

/** `settings` with its keys in `reference`'s order: keys `reference` has keep their place, new keys follow. */
const orderKeysLike = (opts: { settings: TSettings; reference: TSettings }): TSettings => {
  const keys = [
    ...Object.keys(opts.reference).filter(key => key in opts.settings),
    ...Object.keys(opts.settings).filter(key => !(key in opts.reference)),
  ];

  return Object.fromEntries(keys.map(key => [key, opts.settings[key]]));
};

/**
 * `settings` in the key order the user's file already has, here and one level down: a sync that only
 * reorders keys rewrites the file, and `doctor` then calls a fresh sync stale.
 */
export const keepKeyOrder = (opts: { settings: TSettings; reference: TSettings }): TSettings => {
  const ordered = orderKeysLike(opts);

  for (const key of Object.keys(ordered).filter(entry =>
    SyncConstants.MERGE_ONE_LEVEL.has(entry),
  )) {
    const value = { value: ordered[key] };
    const previous = { value: opts.reference[key] };

    if (isSettingsObject(value) && isSettingsObject(previous)) {
      ordered[key] = orderKeysLike({ settings: value.value, reference: previous.value });
    }
  }

  return ordered;
};

/** `settings` without what `managed` (the overlay of a previous sync) put there; anything else stays. */
export const removeManagedSettings = (opts: {
  settings: TSettings;
  managed: TSettings;
}): TSettings => {
  const remaining: TSettings = { ...opts.settings };

  for (const [key, managedValue] of Object.entries(opts.managed)) {
    const current = { value: remaining[key] };
    const managed = { value: managedValue };

    if (
      SyncConstants.UNION_ARRAYS.has(key) &&
      Array.isArray(current.value) &&
      Array.isArray(managedValue)
    ) {
      const managedEntries = new Set(managedValue.map(entry => toKey({ value: entry })));
      const kept = current.value.filter(entry => !managedEntries.has(toKey({ value: entry })));

      if (kept.length > 0) {
        remaining[key] = kept;
      } else {
        delete remaining[key];
      }

      continue;
    }

    if (
      !SyncConstants.MERGE_ONE_LEVEL.has(key) ||
      !isSettingsObject(current) ||
      !isSettingsObject(managed)
    ) {
      if (toKey({ value: remaining[key] }) === toKey({ value: managedValue })) {
        delete remaining[key];
      }

      continue;
    }

    const inner: TSettings = { ...current.value };

    for (const [innerKey, innerManaged] of Object.entries(managed.value)) {
      const innerCurrent = inner[innerKey];

      if (Array.isArray(innerCurrent) && Array.isArray(innerManaged)) {
        const managedKeys = new Set(innerManaged.map(entry => toKey({ value: entry })));
        const unmatched = innerCurrent.filter(entry => !managedKeys.has(toKey({ value: entry })));
        // A hand-edited entry no longer matches whole: its managed hooks still go, by command.
        const kept =
          key === SyncConstants.HOOKS_KEY
            ? removeHookCommands({
                entries: unmatched,
                commands: new Set(extractEntryCommands({ entries: innerManaged })),
              })
            : unmatched;

        if (kept.length > 0) {
          inner[innerKey] = kept;
        } else {
          delete inner[innerKey];
        }

        continue;
      }

      if (toKey({ value: innerCurrent }) === toKey({ value: innerManaged })) {
        delete inner[innerKey];
      }
    }

    if (Object.keys(inner).length > 0) {
      remaining[key] = inner;
    } else {
      delete remaining[key];
    }
  }

  return remaining;
};

/** The project's own hooks from config, in Claude Code's settings shape. */
export const buildProjectHookSettings = (opts: { hooks: TResolvedConfig['hooks'] }): TSettings => {
  const byEvent: Record<string, unknown[]> = {};

  for (const hook of opts.hooks) {
    const entry = {
      ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
      hooks: [{ type: 'command', command: hook.command }],
    };

    byEvent[hook.event] = [...(byEvent[hook.event] ?? []), entry];
  }

  return { hooks: byEvent };
};
