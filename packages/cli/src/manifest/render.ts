import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolvePackages } from '../config/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { readBaseRules } from '../rules/index.ts';

export class ManifestConstants {
  /** Committed; what atlas reads from a project - local or fetched - and nothing else. */
  static readonly FILE = '.agents/vulcan.manifest.json';
  static readonly SCHEMA_VERSION = 1;
  static readonly PROJECT_RULES = '.agents/rules.md';
  static readonly ENV = 'VULCAN_MANIFEST';
}

const HASH_LENGTH = 8;

/** `@acme/shop-workspace` gives `shop`; a project with no package name takes its directory's. */
export const projectNameOf = (opts: { root: string; config: TResolvedConfig }): string => {
  if (opts.config.name !== undefined) {
    return opts.config.name;
  }

  const file = join(opts.root, 'package.json');
  const manifest: { name?: unknown } = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : {};
  const name = typeof manifest.name === 'string' ? manifest.name : basename(opts.root);

  return name
    .replace(/^@[^/]+\//, '')
    .replace(/-workspace$/, '')
    .toLowerCase();
};

/** Each base rule's ID with a hash of its row: a sync after an upgrade can say which rules changed. */
export const buildBaseRuleHashes = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(readBaseRules()).map(([id, row]) => {
      const hash = new Bun.CryptoHasher('sha256').update(row.trim()).digest('hex');

      return [id, hash.slice(0, HASH_LENGTH)];
    }),
  );

/**
 * The project manifest (Project Contract v1, C1): data only, rendered from the config with a fixed
 * key order, so the committed file is byte-stable and a stale one shows as a diff.
 */
export const renderManifest = (opts: { root: string; config: TResolvedConfig }): string => {
  const { config } = opts;
  const { wiki, changelogs, syncAreas } = config.knowledge;

  const manifest = {
    schemaVersion: ManifestConstants.SCHEMA_VERSION,
    name: projectNameOf(opts),
    packages: resolvePackages({ config }).map(entry => ({
      name: entry.name,
      dir: entry.dir,
      path: entry.path,
      aliases: entry.aliases,
      retired: entry.retired,
    })),
    knowledge: {
      bundle: config.knowledge.bundle,
      ...(wiki === undefined ? {} : { wiki }),
      ...(changelogs === undefined ? {} : { changelogs }),
      ...(syncAreas === undefined ? {} : { syncAreas }),
    },
    release: {
      tagPattern: config.atlas.tagPattern,
      legacyTagPrefixes: config.atlas.legacyTagPrefixes ?? [],
      ignoreTags: config.atlas.ignoreTags ?? [],
    },
    rules: { project: ManifestConstants.PROJECT_RULES, base: buildBaseRuleHashes() },
    // The sources this project reads knowledge from (atlas, git mode); a project without any carries none.
    ...(config.atlas.sources.length === 0 ? {} : { sources: config.atlas.sources }),
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
};
