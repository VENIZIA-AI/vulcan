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
        const kept = innerCurrent.filter(entry => !managedKeys.has(toKey({ value: entry })));

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
