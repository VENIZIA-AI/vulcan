import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestConstants, ProjectManifest } from '../manifest/index.ts';
import { BaseRules } from '../rules/index.ts';
import { BaseRuleChanges } from './common/index.ts';
import type { IBaseRuleChange } from './common/index.ts';

/** `| V-W-02 | Never write ... | HARD |` gives `Never write ... | HARD`. */
const toRuleText = (opts: { row: string }): string =>
  opts.row
    .trim()
    .replace(/^\|[^|]*\|\s*/, '')
    .replace(/\s*\|$/, '');

/**
 * The hashes the last sync recorded: those of the local manifest, else of the manifest of an earlier release (the first sync
 * after an upgrade still reports the rules that changed); none before a first sync or when it is unreadable.
 */
const readSyncedHashes = (opts: { root: string }): Record<string, unknown> => {
  const file = [ManifestConstants.FILE, ManifestConstants.LEGACY_FILE]
    .map((name) => join(opts.root, name))
    .find((path) => existsSync(path));

  if (file === undefined) {
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

export class BaseRulesDiff {
  /** V3: each base rule added, changed or removed since the last sync recorded in the manifest. */
  static diff(opts: { root: string; packs?: string[] }): IBaseRuleChange[] {
    const synced = readSyncedHashes(opts);

    if (Object.keys(synced).length === 0) {
      return [];
    }

    const installed = ProjectManifest.buildBaseRuleHashes({ packs: opts.packs });
    const rows = BaseRules.read({ packs: opts.packs });
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
        text: '',
      });
    }

    return changes;
  }
}
