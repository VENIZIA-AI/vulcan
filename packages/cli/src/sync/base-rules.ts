import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBaseRuleHashes, ManifestConstants } from '../manifest/index.ts';
import { readBaseRules, readRetiredRuleIds } from '../rules/index.ts';
import { BaseRuleChanges } from './common/index.ts';
import type { IBaseRuleChange } from './common/index.ts';

/** `| V-W-02 | Never write ... | HARD |` gives `Never write ... | HARD`. */
const toRuleText = (opts: { row: string }): string =>
  opts.row
    .trim()
    .replace(/^\|[^|]*\|\s*/, '')
    .replace(/\s*\|$/, '');

/** The hashes the committed manifest recorded; none before a first sync or when it is unreadable. */
const readSyncedHashes = (opts: { root: string }): Record<string, unknown> => {
  const file = join(opts.root, ManifestConstants.FILE);

  if (!existsSync(file)) {
    return {};
  }

  try {
    const manifest: { rules?: { base?: Record<string, unknown> } } = JSON.parse(
      readFileSync(file, 'utf8'),
    );

    return manifest.rules?.base ?? {};
  } catch (error) {
    console.error(
      `[readSyncedHashes] ${file} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return {};
  }
};

/** V3: each base rule added, changed or removed since the committed manifest's last sync. */
export const diffBaseRules = (opts: { root: string }): IBaseRuleChange[] => {
  const synced = readSyncedHashes(opts);

  if (Object.keys(synced).length === 0) {
    return [];
  }

  const installed = buildBaseRuleHashes();
  const rows = readBaseRules();
  const retired = new Set(readRetiredRuleIds());
  const changes: IBaseRuleChange[] = [];

  for (const [id, hash] of Object.entries(installed)) {
    if (synced[id] === hash) {
      continue;
    }

    changes.push({
      id,
      change: synced[id] === undefined ? BaseRuleChanges.ADDED : BaseRuleChanges.CHANGED,
      text: toRuleText({ row: rows[id] }),
    });
  }

  for (const id of Object.keys(synced).filter((syncedId) => installed[syncedId] === undefined)) {
    changes.push({
      id,
      change: BaseRuleChanges.REMOVED,
      text: retired.has(id) ? '(retired)' : '',
    });
  }

  return changes;
};
