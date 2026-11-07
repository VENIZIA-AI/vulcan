import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BunFormatter, EnvVariables } from '../common/index.ts';
import { AgentSignaturePolicies } from '../commit/common/index.ts';
import { ProjectPackages } from '../config/index.ts';
import { GuardDecisions } from '../hooks/common/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { BaseRules } from '../rules/index.ts';
import { ThemeTokens } from '../theme/index.ts';

export class ManifestConstants {
  /** Committed; what atlas reads from a project - local or fetched - and nothing else. */
  static readonly FILE = '.agents/vulcan.manifest.json';
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
 * config this VULCAN cannot parse never changes a guard: `outside` (when it is not the default), `toolOwnedPaths`,
 * the commands and trusted scripts of guard-writes, the push targets of guard-git.
 */
const guardBlockOf = (opts: { config: TResolvedConfig }): { guard?: Record<string, unknown> } => {
  const { commands, trustedScripts } = opts.config.guard.writes;
  const { askPush } = opts.config.guard.git;
  const { outside, toolOwnedPaths } = opts.config.guard;
  const trustedPaths = trustedScripts.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : [],
  );
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
    ...(trustedPaths.length === 0 ? {} : { trustedScripts: trustedPaths }),
    ...(readOnlyScripts.length === 0 ? {} : { readOnlyScripts }),
  };
  const block = {
    ...(outside === GuardDecisions.ASK ? {} : { outside }),
    ...(toolOwnedPaths.length === 0 ? {} : { toolOwnedPaths }),
    ...(Object.keys(writes).length === 0 ? {} : { writes }),
    ...(askPush.length === 0 ? {} : { git: { askPush } }),
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

/** The manifest's `graph` block, which atlas reads: only what the project sets. */
const graphBlockOf = (opts: { config: TResolvedConfig }): { graph?: Record<string, unknown> } => {
  const { exclude, aliases } = opts.config.graph;
  const block = {
    ...(exclude.length === 0 ? {} : { exclude }),
    ...(Object.keys(aliases).length === 0 ? {} : { aliases }),
  };

  return Object.keys(block).length === 0 ? {} : { graph: block };
};

/** The manifest's `ci` block, which `vulcan ci affected` reads: only the globs the project adds. */
const ciBlockOf = (opts: { config: TResolvedConfig }): { ci?: Record<string, unknown> } => {
  const { global } = opts.config.ci.affected;

  return global.length === 0 ? {} : { ci: { affected: { global } } };
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

/** Renders `.agents/vulcan.manifest.json` from the config and the base rule hashes; written by `vulcan sync`. */
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
      // The design tokens: the preset, the seeds the project gave and the resolved set every consumer reads.
      ...themeBlockOf({ config }),
      ...commitBlockOf({ config }),
      // The files the project adds to the ones that make every package affected; none added, nothing is written.
      ...ciBlockOf({ config }),
      // The names and the logo `vulcan board` puts on its page; nothing set, nothing is written.
      ...boardBlockOf({ config }),
      // The automatic clean of .agents/local is on unless the project turns it off here.
      ...localBlockOf({ config }),
      ...graphBlockOf({ config }),
      // Whether the Claude Code hooks write the agent event log, and the folder it goes to.
      ...eventsBlockOf({ config }),
      // The key a flow is named by; the hooks and `vulcan event` read it here, not from the config.
      ...(config.project === undefined ? {} : { project: { key: config.project.key } }),
    };

    return BunFormatter.format({
      text: `${JSON.stringify(manifest, null, 2)}\n`,
      file: ManifestConstants.FILE,
    });
  }
}
