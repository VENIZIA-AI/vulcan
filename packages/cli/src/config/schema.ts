import { z } from 'zod';
import { layoutFolderProblem, layoutOverlapProblems } from '../common/layout-folder.ts';
import { OWNER_SCHEMA } from '../owner/schema.ts';
import { CodingAgents, ConfigConstants, HookEvents, PackageKinds } from './common/index.ts';

const CODING_AGENT = z.string().refine((value) => CodingAgents.isValid(value), {
  message: `one of: ${[...CodingAgents.SCHEME_SET].join(', ')}`,
});
const HOOK_EVENT = z.string().refine((value) => HookEvents.isValid(value), {
  message: `one of: ${[...HookEvents.SCHEME_SET].join(', ')}`,
});

/** A layout folder: 1 to 4 plain segments, never climbing, never absolute (the validator `guard-package` shares). */
const LAYOUT_FOLDER = z.string().superRefine((value, context) => {
  const problem = layoutFolderProblem({ folder: value });

  if (problem !== undefined) {
    context.addIssue({ code: 'custom', message: problem });
  }
});

/** One folder, or a list of them: a side whose apps are grouped keeps each group's folder. */
const LAYOUT_VALUE = z.union([LAYOUT_FOLDER, z.array(LAYOUT_FOLDER).min(1)]);

const PROJECT_PACKAGE = z.strictObject({
  dir: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  name: z.string(),
  /** Where the package lives, from the root; default `packages/<dir>`. */
  path: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  retired: z.boolean().default(false),
  /** A shared package a preset's lib kind made lives anywhere a workspace glob covers; absent means an app or a plain package. */
  kind: z.enum([PackageKinds.APP, PackageKinds.LIB]).optional(),
});

/** A path as a key: no leading `./`, no trailing slash. */
const pathKeyOf = (opts: { path: string }): string =>
  opts.path.replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * `dir` is a unique KEY (it need not be the directory name - set `path` for that), so two packages
 * whose directories are both called `core` are `umbras-core` and `kits-core`. A repeated key, name or
 * live path would make every table keyed by it collide silently.
 */
const checkPackagesUnique = (
  packages: z.infer<typeof PROJECT_PACKAGE>[],
  context: z.RefinementCtx,
): void => {
  const seen = { dir: new Set<string>(), name: new Set<string>(), path: new Set<string>() };

  for (const [index, entry] of packages.entries()) {
    const path = pathKeyOf({ path: entry.path ?? `packages/${entry.dir}` });
    const repeated = [
      seen.dir.has(entry.dir)
        ? `packages: dir '${entry.dir}' is used twice - dir is a unique key, not the directory name; give each package its own dir and set path`
        : undefined,
      seen.name.has(entry.name) ? `packages: name '${entry.name}' is used twice` : undefined,
      !entry.retired && seen.path.has(path) ? `packages: path '${path}' is used twice` : undefined,
    ];

    for (const message of repeated) {
      if (message !== undefined) {
        context.addIssue({ code: 'custom', message, path: [index] });
      }
    }

    seen.dir.add(entry.dir);
    seen.name.add(entry.name);

    if (!entry.retired) {
      seen.path.add(path);
    }
  }
};

/**
 * A release template: `<dir>` (synonym `<package>`) is the package DIRECTORY - the `packages` key,
 * never the npm name (`packages/core-server` published as `@acme/server` tags `core-server-v1.2.0`); `<version>` is the
 * version; `<issue>` an issue number. Every other character is literal. When matching a commit, a
 * leading `[#<issue>] ` is optional and a trailing ` [<mode>]` is tolerated. A release train that
 * tags once leaves `<dir>` out (`v<version>`).
 */
const RELEASE_TEMPLATE = z.string().refine((value) => value.includes('<version>'), {
  message: 'a template with <version> (and <dir> or <package> for per-package releases)',
});

/** A key the config once accepted and no tool ever read: still named, so the error says it is gone rather than "unrecognized". */
const removedAtlasKey = (opts: { key: string }) =>
  z
    .never({
      error: `atlas.${opts.key} was removed - no tool reads it; delete it from the config`,
    })
    .optional();

/** A renderer by id: a built-in, or a project module (`module`); a bare string is the id alone. */
const OKF_RENDERER = z.union([
  z.string().transform((id) => ({ id, options: {} })),
  z.strictObject({
    id: z.string(),
    module: z.string().optional(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
]);

/** A host name, or a pattern whose only wildcard is `*`; a `$VAR` stands for a host the shell expands. Never a user, a path or a port. */
const REMOTE_HOST = z
  .string()
  .regex(
    /^(?:\$\{?\w+\}?|[A-Za-z0-9._*-]+)$/,
    'a host name or a pattern with *, not a user, a path or a port',
  )
  .refine((value) => value.replaceAll('*', '').replaceAll('.', '') !== '', {
    message: 'a pattern needs at least one literal character beyond * and .',
  });

const VIZ_OUTPUT = '.agents/knowledge/viz.html';

/** `.configs/vulcan.config.*` - strict: an unknown key is a typo, and a typo is an error. */
export const VULCAN_CONFIG_SCHEMA = z.strictObject({
  /** The project's name in the manifest and in every atlas result; default: the root package name, unscoped. */
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  /** The project's suggested agents; each developer's own choice lives in `.agents/vulcan.local.json`. */
  agents: z.array(CODING_AGENT).optional(),
  rules: z.record(z.string().regex(ConfigConstants.RULE_ID_PATTERN), z.string()).default({}),
  /** The folders `vulcan init` and `add` put apps in, as the user named them. */
  layout: z
    .strictObject({
      backend: LAYOUT_VALUE.optional(),
      frontend: LAYOUT_VALUE.optional(),
      shared: LAYOUT_VALUE.optional(),
      /** Folders the layout does not manage (docs, third-party code, tests): packages there are allowed, never targeted by `add`, never guarded. */
      other: LAYOUT_VALUE.optional(),
    })
    .superRefine((layout, context) => {
      for (const problem of layoutOverlapProblems({ layout })) {
        context.addIssue({ code: 'custom', message: problem });
      }
    })
    .optional(),
  /** The presets this project's apps came from (`init` and `add` record them), as `--preset` takes them back. */
  presets: z
    .array(
      z.strictObject({
        spec: z.string().min(1),
        side: z.enum(['backend', 'frontend']),
        summary: z.string(),
        /** The summary of the preset's lib kind, when it ships one. */
        lib: z.string().optional(),
      }),
    )
    .optional(),
  /** The project's packages in release order; okf, atlas, make and release read this one list. */
  packages: z.array(PROJECT_PACKAGE).superRefine(checkPackagesUnique).default([]),
  knowledge: z
    .strictObject({
      bundle: z.string().default(ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE),
      wiki: z.string().optional(),
      changelogs: z.string().optional(),
      /** The knowledge-sync skill's map of code areas to concepts. */
      syncAreas: z.string().optional(),
    })
    .default({ bundle: ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE }),
  okf: z
    .strictObject({
      renderers: z.array(OKF_RENDERER).default([]),
      regions: z
        .array(z.strictObject({ id: z.string(), file: z.string(), renderer: z.string() }))
        .default([]),
      sections: z
        .strictObject({
          order: z.array(z.string()).default([]),
          labels: z.record(z.string(), z.string()).default({}),
        })
        .default({ order: [], labels: {} }),
      /** `exclude`: globs from the root dropped from this axis; `denylist`: directory names dropped from this axis only. */
      coverage: z
        .array(
          z.strictObject({
            name: z.string(),
            path: z.string(),
            exclude: z.array(z.string()).default([]),
            denylist: z.array(z.string()).default([]),
          }),
        )
        .default([]),
      /** Directory names no axis counts; an axis's own `denylist` scopes the same idea to one axis. */
      denylist: z.array(z.string()).default([]),
      /** Agent-read files outside the bundle that get a generated contents list when they pass 100 lines. */
      contents: z
        .strictObject({ files: z.array(z.string()).default(['AGENTS.md', '.agents/rules.md']) })
        .default({ files: ['AGENTS.md', '.agents/rules.md'] }),
      viz: z
        .strictObject({
          outputs: z.array(z.string()).default([VIZ_OUTPUT]),
          brand: z.string().optional(),
          copy: z.record(z.string(), z.unknown()).optional(),
        })
        .default({ outputs: [VIZ_OUTPUT] }),
    })
    .default({
      renderers: [],
      regions: [],
      sections: { order: [], labels: {} },
      coverage: [],
      denylist: [],
      contents: { files: ['AGENTS.md', '.agents/rules.md'] },
      viz: { outputs: [VIZ_OUTPUT] },
    }),
  atlas: z
    .strictObject({
      /** Removed in 0.2.0-8; present only so the error can name `packages`. */
      packages: z
        .never({
          error:
            'atlas.packages was removed - move the list to the top-level packages: [{ dir, name }] (release order; dir is the old key, name the old value)',
        })
        .optional(),
      releaseCommit: removedAtlasKey({ key: 'releaseCommit' }),
      typescriptFrom: removedAtlasKey({ key: 'typescriptFrom' }),
      legacyTagPrefixes: removedAtlasKey({ key: 'legacyTagPrefixes' }),
      tagPattern: RELEASE_TEMPLATE.default('<dir>-v<version>'),
      sources: z
        .array(
          z.strictObject({
            name: z.string(),
            repo: z.string(),
            ref: z.string().default('develop'),
            /** `installed` (default): the docs are read at the tag of the newest installed package; `ref`: at `ref`. */
            pin: z.enum(['installed', 'ref']).optional(),
          }),
        )
        .default([]),
      /** Tags neither read nor checked (globs) - an old layout's tags. */
      ignoreTags: z.array(z.string()).optional(),
    })
    .default({
      tagPattern: '<dir>-v<version>',
      sources: [],
    }),
  /**
   * The remote-host guard (W-04 in a project's own words): with this key set, sync registers a hook that
   * asks before a Bash command reaches a host not listed here. `trusted` hosts are free; `readOnly`
   * hosts pass only the strict read-only forms. Matching is by whole name or `*` pattern, never by substring.
   * `localFile` is a gitignored list of personal trusted hosts, one per line.
   */
  remoteHosts: z
    .strictObject({
      trusted: z.array(REMOTE_HOST).default([]),
      readOnly: z.array(REMOTE_HOST).default([]),
      localFile: z.string().default('.agents/hooks/trusted-hosts.local'),
    })
    .optional(),
  /** Team-shared Claude settings (permissions, env, enabledPlugins...), merged by sync over personal keys. */
  claude: z
    .strictObject({ settings: z.record(z.string(), z.unknown()).default({}) })
    .default({ settings: {} }),
  hooks: z
    .array(
      z.strictObject({ event: HOOK_EVENT, matcher: z.string().optional(), command: z.string() }),
    )
    .default([]),
  /** The session-start digest: the rule IDs it repeats as "the rules sessions drop most" - base or the project's own. */
  digest: z
    .strictObject({
      oftenDropped: z
        .array(z.string().regex(ConfigConstants.RULE_ID_PATTERN))
        .default(ConfigConstants.DEFAULT_OFTEN_DROPPED),
    })
    .default({ oftenDropped: ConfigConstants.DEFAULT_OFTEN_DROPPED }),
  /** The report contract for answers to the project's owners; English and `advise` by default. */
  owner: OWNER_SCHEMA,
  /**
   * The hooks that guard writes. `toolOwnedPaths` extends the defaults (package manager caches, the
   * runtime dir for locks, git config, the agent tool's memory) with stores a tool in this project
   * manages itself: absolute globs, `~` and `$NAME` allowed.
   */
  guard: z
    .strictObject({ toolOwnedPaths: z.array(z.string().min(1)).default([]) })
    .default({ toolOwnedPaths: [] }),
});

export type VulcanConfig = z.input<typeof VULCAN_CONFIG_SCHEMA>;
export type TResolvedConfig = z.output<typeof VULCAN_CONFIG_SCHEMA>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfig): VulcanConfig => config;
