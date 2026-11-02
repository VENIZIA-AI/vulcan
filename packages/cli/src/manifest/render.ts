import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BunFormatter } from '../common/index.ts';
import { ProjectPackages } from '../config/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { BaseRules } from '../rules/index.ts';

export class ManifestConstants {
  /** Committed; what atlas reads from a project - local or fetched - and nothing else. */
  static readonly FILE = '.agents/vulcan.manifest.json';
  static readonly SCHEMA_VERSION = 1;
  static readonly PROJECT_RULES = '.agents/rules.md';
  static readonly ENV = 'VULCAN_MANIFEST';
  /** The first key: a reader sees at once that the file is generated. Readers ignore it. */
  static readonly GENERATED_KEY = '$generated';
  static readonly GENERATED_NOTE = 'by vulcan sync from .configs/vulcan.config.* - do not edit';
}

const HASH_LENGTH = 8;

/** The manifest's `guard` block: what the project adds to guard-writes and guard-git, as data a hook reads without the config (the read-only script entries of `trustedScripts` included). */
const guardBlockOf = (opts: { config: TResolvedConfig }): { guard?: Record<string, unknown> } => {
  const { commands, trustedScripts } = opts.config.guard.writes;
  const { askPush } = opts.config.guard.git;
  // Only the object entries: a path string is read from the config by the hook, as before.
  const readOnlyScripts = trustedScripts.flatMap((entry) =>
    typeof entry === 'string' ? [] : [{ script: entry.script, readOnly: entry.readOnly }],
  );
  const writes = {
    ...(commands.length === 0
      ? {}
      : {
          commands: commands.map((command) => ({
            rule: command.rule,
            what: command.what,
            pattern: command.pattern,
            ...(command.ignoreCase === true ? { ignoreCase: true } : {}),
          })),
        }),
    ...(readOnlyScripts.length === 0 ? {} : { readOnlyScripts }),
  };
  const block = {
    ...(Object.keys(writes).length === 0 ? {} : { writes }),
    ...(askPush.length === 0 ? {} : { git: { askPush } }),
  };

  return Object.keys(block).length === 0 ? {} : { guard: block };
};

/** The manifest's `atlas` block: only what the config sets (keys listed, the download turned off). */
const atlasBlockOf = (opts: { config: TResolvedConfig }): { atlas?: Record<string, unknown> } => {
  const keys = opts.config.atlas.index?.keys ?? [];
  const block = {
    ...(keys.length === 0 ? {} : { index: { keys } }),
    ...(opts.config.atlas.prebuilt === false ? { prebuilt: false } : {}),
  };

  return Object.keys(block).length === 0 ? {} : { atlas: block };
};

export class ProjectManifest {
  /** `@acme/shop-workspace` gives `shop`; a project with no package name takes its directory's. */
  static projectNameOf(opts: { root: string; config: TResolvedConfig }): string {
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
  }

  /** Each base rule's ID with a hash of its row: a sync after an upgrade can say which rules changed. */
  static buildBaseRuleHashes(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(BaseRules.read()).map(([id, row]) => {
        const hash = new Bun.CryptoHasher('sha256').update(row.trim()).digest('hex');

        return [id, hash.slice(0, HASH_LENGTH)];
      }),
    );
  }

  /**
   * The project manifest (Project Contract v1, C1): data only, rendered from the config with a fixed
   * key order, so the committed file is byte-stable and a stale one shows as a diff.
   */
  static render(opts: { root: string; config: TResolvedConfig }): string {
    const { config } = opts;
    const { wiki, changelogs, syncAreas } = config.knowledge;

    const manifest = {
      [ManifestConstants.GENERATED_KEY]: ManifestConstants.GENERATED_NOTE,
      schemaVersion: ManifestConstants.SCHEMA_VERSION,
      name: ProjectManifest.projectNameOf(opts),
      packages: ProjectPackages.resolve({ config }).map((entry) => ({
        name: entry.name,
        dir: entry.dir,
        path: entry.path,
        aliases: entry.aliases,
        retired: entry.retired,
        ...(entry.kind === undefined ? {} : { kind: entry.kind }),
        ...(entry.presetKind === undefined ? {} : { presetKind: entry.presetKind }),
      })),
      // Where each kind of app goes and the presets that make one: what an agent asked for a new app needs.
      ...(config.layout === undefined ? {} : { layout: config.layout }),
      ...(config.presets === undefined ? {} : { presets: config.presets }),
      knowledge: {
        bundle: config.knowledge.bundle,
        ...(wiki === undefined ? {} : { wiki }),
        ...(changelogs === undefined ? {} : { changelogs }),
        ...(syncAreas === undefined ? {} : { syncAreas }),
      },
      release: {
        tagPattern: config.atlas.tagPattern,
        ...(config.atlas.legacyTagPatterns === undefined ||
        config.atlas.legacyTagPatterns.length === 0
          ? {}
          : { legacyTagPatterns: config.atlas.legacyTagPatterns }),
        ignoreTags: config.atlas.ignoreTags ?? [],
      },
      rules: {
        project: ManifestConstants.PROJECT_RULES,
        base: ProjectManifest.buildBaseRuleHashes(),
      },
      // The sources this project reads knowledge from (atlas, git mode); a project without any carries none.
      ...(config.atlas.sources.length === 0 ? {} : { sources: config.atlas.sources }),
      // The prebuilt index: the keys a published pair is checked with, and the switch; neither set, nothing is written.
      ...atlasBlockOf({ config }),
      // The commands and push targets the guards ask about beyond their own list; neither set, nothing is written.
      ...guardBlockOf({ config }),
      // The remote-host guard reads its policy here; a project without the key has no guard.
      ...(config.remoteHosts === undefined ? {} : { remoteHosts: config.remoteHosts }),
      // The colour `vulcan visualize` takes for its pages; a project without the key gets the neutral default.
      ...(config.theme === undefined ? {} : { theme: config.theme }),
    };

    return BunFormatter.format({
      text: `${JSON.stringify(manifest, null, 2)}\n`,
      file: ManifestConstants.FILE,
    });
  }
}
