import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ProviderTypes } from '../board/common/constants.ts';
import { BunFormatter, EnvVariables } from '../common/index.ts';
import { AgentSignaturePolicies } from '../commit/common/index.ts';
import { ProjectPackages } from '../config/index.ts';
import { ConfigImports } from '../config/imports.ts';
import { GuardDecisions } from '../hooks/common/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { BaseRules } from '../rules/index.ts';
import { ThemeTokens } from '../theme/index.ts';

export class ManifestConstants {
  /** Local, not committed: the whole manifest, which every hook, the board and the doctor read. Each clone writes its own with `vulcan sync`. */
  static readonly FILE = '.agents/local/vulcan.manifest.json';
  /** Committed and generated: the part of the manifest that readers of a checkout need without running `vulcan sync` (atlas, the wiki build). */
  static readonly DESCRIPTOR_FILE = '.agents/atlas.manifest.json';
  /**
   * The one file of earlier releases, kept as a DATA-ONLY copy of the descriptor (the same text) until the stable 0.5.0
   * release: atlas of 0.5.0-6 and before reads a source's manifest only at this path, and resolves a source's ref through it
   * before it can pin a release tag. A newer atlas reads the descriptor first.
   */
  static readonly LEGACY_FILE = '.agents/vulcan.manifest.json';
  /** The keys of the descriptor: what `ProjectConfig` of atlas reads from a manifest, and the resolved theme the wiki build takes its colours from. */
  static readonly DESCRIPTOR_KEYS = [
    '$generated',
    'schemaVersion',
    'name',
    'packages',
    'layout',
    'presets',
    'knowledge',
    'release',
    'sources',
    'atlas',
    'theme',
  ];
  static readonly SCHEMA_VERSION = 1;
  static readonly PROJECT_RULES = '.agents/rules.md';
  static readonly ENV = EnvVariables.VULCAN_MANIFEST;
  /** The first key: a reader sees at once that the file is generated. Readers ignore it. */
  static readonly GENERATED_KEY = '$generated';
  static readonly GENERATED_NOTE = 'by vulcan sync from .configs/vulcan.config.* - do not edit';
}

const HASH_LENGTH = 8;

/**
 * The manifest's `guard` block: what the project sets for the guards, as data a hook reads without the config, so a
 * config this VULCAN cannot parse never changes a guard: `outside` and `asks` (when not the default), `toolOwnedPaths`,
 * the commands of guard-writes, the push targets of guard-git, the runners the runner guard accepts, and the modules under
 * `.configs/` the config imports, which guard-outside protects like the config.
 */
const guardBlockOf = (opts: {
  config: TResolvedConfig;
  configModules: string[];
}): { guard?: Record<string, unknown> } => {
  const { configModules } = opts;
  const { commands } = opts.config.guard.writes;
  const { askPush } = opts.config.guard.git;
  const { allow } = opts.config.guard.runners;
  const { outside, asks, toolOwnedPaths } = opts.config.guard;
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
  };
  const block = {
    ...(outside === GuardDecisions.ASK ? {} : { outside }),
    ...(asks === GuardDecisions.ASK ? {} : { asks }),
    ...(toolOwnedPaths.length === 0 ? {} : { toolOwnedPaths }),
    ...(configModules.length === 0 ? {} : { configModules }),
    ...(Object.keys(writes).length === 0 ? {} : { writes }),
    ...(askPush.length === 0 ? {} : { git: { askPush } }),
    ...(allow.length === 0 ? {} : { runners: { allow } }),
  };

  return Object.keys(block).length === 0 ? {} : { guard: block };
};

const commitBlockOf = (opts: { config: TResolvedConfig }): { commit?: Record<string, unknown> } => {
  const { agent, subject } = opts.config.commit.message;
  const isDenied = agent.signature === AgentSignaturePolicies.DENY;

  if (!isDenied && subject === undefined) {
    return {};
  }

  return {
    commit: {
      message: {
        agent: {
          signature: agent.signature,
          ...(isDenied && agent.names.length > 0 ? { names: agent.names } : {}),
          ...(isDenied && agent.allow.length > 0 ? { allow: agent.allow } : {}),
        },
        ...(subject === undefined ? {} : { subject }),
      },
    },
  };
};

/** The manifest's `events` block, which the hooks and `vulcan event` read: only when the log is on or has a folder. */
const eventsBlockOf = (opts: { config: TResolvedConfig }): { events?: Record<string, unknown> } => {
  const { log, dir, maxSize, maxFiles, maxAgeDays } = opts.config.events;
  const limits = {
    ...(maxSize === undefined ? {} : { maxSize }),
    ...(maxFiles === undefined ? {} : { maxFiles }),
    ...(maxAgeDays === undefined ? {} : { maxAgeDays }),
  };

  return log || dir !== undefined || Object.keys(limits).length > 0
    ? { events: { log, ...(dir === undefined ? {} : { dir }), ...limits } }
    : {};
};

/** The manifest's `local` block, which the hooks and `vulcan clean` read: when the automatic clean is off or the project names its tmp folder. */
const localBlockOf = (opts: { config: TResolvedConfig }): { local?: Record<string, unknown> } => {
  const { autoClean, tmp } = opts.config.local;
  const block = {
    ...(autoClean ? {} : { autoClean: false }),
    ...(tmp === undefined ? {} : { tmp }),
  };

  return Object.keys(block).length === 0 ? {} : { local: block };
};

/**
 * The manifest's `theme` block: the accent seeds the project gave, its preset, and the resolved design tokens (both
 * modes, font, mono, radius) that the board, the pages and the wiki read. Always written: a project with no `theme`
 * gets the default preset. A theme the check refused never reaches here (the config does not load).
 */
const themeBlockOf = (opts: { config: TResolvedConfig }): { theme?: Record<string, unknown> } => {
  const resolved = ThemeTokens.resolve({ theme: opts.config.theme });

  if (!resolved.ok) {
    return {};
  }

  const { preset, light, dark, font, mono, radius } = resolved.tokens;
  const { accent, accentDark, accentText } = opts.config.theme ?? {};

  return {
    theme: {
      ...(accent === undefined ? {} : { accent }),
      ...(accentDark === undefined ? {} : { accentDark }),
      ...(accentText === undefined ? {} : { accentText }),
      preset,
      tokens: { light, dark },
      font,
      mono,
      radius,
    },
  };
};

/** The manifest's `board` block, which `vulcan board` reads: only what the project sets. */
const boardBlockOf = (opts: { config: TResolvedConfig }): { board?: Record<string, unknown> } => {
  const { owner, title, logo, hostname, agents } = opts.config.board;

  return owner === undefined &&
    title === undefined &&
    hostname === undefined &&
    logo === undefined &&
    Object.keys(agents).length === 0
    ? {}
    : {
        board: {
          ...(owner === undefined ? {} : { owner }),
          ...(title === undefined ? {} : { title }),
          ...(logo === undefined ? {} : { logo }),
          ...(hostname === undefined ? {} : { hostname }),
          ...(Object.keys(agents).length === 0 ? {} : { agents }),
        },
      };
};

/** The manifest's `provider` block, which `vulcan board` reads: written only when the code host is not GitHub. */
const providerBlockOf = (opts: {
  config: TResolvedConfig;
}): { provider?: Record<string, unknown> } => {
  const { type, host } = opts.config.provider;

  return type === ProviderTypes.GITHUB
    ? {}
    : { provider: { type, ...(host === undefined ? {} : { host }) } };
};

/** The manifest's `atlas` block: only what the config sets (keys listed, the download turned off). */
const atlasBlockOf = (opts: { config: TResolvedConfig }): { atlas?: Record<string, unknown> } => {
  const keys = opts.config.atlas.index?.keys ?? [];
  const block = {
    ...(keys.length === 0 ? {} : { index: { keys } }),
    ...(opts.config.atlas.prebuilt === false ? { prebuilt: false } : {}),
    ...(opts.config.atlas.limits?.download === undefined
      ? {}
      : { limits: { download: opts.config.atlas.limits.download } }),
  };

  return Object.keys(block).length === 0 ? {} : { atlas: block };
};

/** Renders `.agents/local/vulcan.manifest.json` from the config and the base rule hashes; written by `vulcan sync`. */
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
  static buildBaseRuleHashes(opts: { packs?: string[] } = {}): Record<string, string> {
    return Object.fromEntries(
      Object.entries(BaseRules.read(opts)).map(([id, row]) => {
        const hash = new Bun.CryptoHasher('sha256').update(row.trim()).digest('hex');

        return [id, hash.slice(0, HASH_LENGTH)];
      }),
    );
  }

  /**
   * The local manifest (Project Contract v1, C1): data only, rendered from the config with a fixed key order, so a stale
   * one shows as a diff. Not committed: every clone writes it with `vulcan sync`.
   */
  static render(opts: { root: string; config: TResolvedConfig }): string {
    return BunFormatter.format({
      text: `${JSON.stringify(ProjectManifest.build(opts), null, 2)}\n`,
      file: ManifestConstants.FILE,
    });
  }

  /**
   * Whether the repository publishes, so other projects read it as an atlas source: it signs the index it publishes
   * (`atlas.index.keys`). Only such a repository writes the committed descriptor; an app keeps everything in the local manifest.
   */
  static publishes(opts: { config: TResolvedConfig }): boolean {
    return (opts.config.atlas.index?.keys.length ?? 0) > 0;
  }

  /** The committed descriptor: the keys of the manifest that atlas reads, in the same order and with the same values. */
  static renderDescriptor(opts: { root: string; config: TResolvedConfig }): string {
    const whole = ProjectManifest.build(opts);
    const descriptor = Object.fromEntries(
      Object.entries(whole).filter(([key]) => ManifestConstants.DESCRIPTOR_KEYS.includes(key)),
    );

    return BunFormatter.format({
      text: `${JSON.stringify(descriptor, null, 2)}\n`,
      file: ManifestConstants.DESCRIPTOR_FILE,
    });
  }

  private static build(opts: { root: string; config: TResolvedConfig }): Record<string, unknown> {
    const { config } = opts;
    const { wiki, changelogs, migrationFrom, datedUntil, siteUrl, codemodCommand } =
      config.knowledge;

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
        migrationFrom,
        ...(datedUntil === undefined ? {} : { datedUntil }),
        ...(siteUrl === undefined ? {} : { siteUrl }),
        ...(codemodCommand === undefined ? {} : { codemodCommand }),
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
        base: ProjectManifest.buildBaseRuleHashes({ packs: config.packs }),
      },
      // The sources this project reads knowledge from (atlas, git mode); a project without any carries none.
      ...(config.atlas.sources.length === 0 ? {} : { sources: config.atlas.sources }),
      // The prebuilt index: the keys a published pair is checked with, and the switch; neither set, nothing is written.
      ...atlasBlockOf({ config }),
      // The commands and push targets the guards ask about beyond their own list; neither set, nothing is written.
      ...guardBlockOf({ config, configModules: ConfigImports.localModules({ root: opts.root }) }),
      // The design tokens: the preset, the seeds the project gave and the resolved set every consumer reads.
      ...themeBlockOf({ config }),
      ...commitBlockOf({ config }),
      // The names and the logo `vulcan board` puts on its page; nothing set, nothing is written.
      ...boardBlockOf({ config }),
      // The code host the board reads; GitHub, the default, writes nothing.
      ...providerBlockOf({ config }),
      // The automatic clean of .agents/local is on unless the project turns it off here.
      ...localBlockOf({ config }),
      // Whether the Claude Code hooks write the agent event log, and the folder it goes to.
      ...eventsBlockOf({ config }),
      // The key a flow is named by; the hooks and `vulcan event` read it here, not from the config.
      ...(config.project === undefined ? {} : { project: { key: config.project.key } }),
    };

    return manifest;
  }
}
