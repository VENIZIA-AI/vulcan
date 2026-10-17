import { z } from 'zod';
import { CodingAgents, ConfigConstants, HookEvents } from './common/index.ts';

const CODING_AGENT = z.string().refine(value => CodingAgents.isValid(value), {
  message: `one of: ${[...CodingAgents.SCHEME_SET].join(', ')}`,
});
const HOOK_EVENT = z.string().refine(value => HookEvents.isValid(value), {
  message: `one of: ${[...HookEvents.SCHEME_SET].join(', ')}`,
});

const PROJECT_PACKAGE = z.strictObject({
  dir: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  name: z.string(),
  /** Where the package lives, from the root; default `packages/<dir>`. */
  path: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  retired: z.boolean().default(false),
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
const RELEASE_TEMPLATE = z.string().refine(value => value.includes('<version>'), {
  message: 'a template with <version> (and <dir> or <package> for per-package releases)',
});

/** A renderer by id: a built-in, or a project module (`module`); a bare string is the id alone. */
const OKF_RENDERER = z.union([
  z.string().transform(id => ({ id, options: {} })),
  z.strictObject({
    id: z.string(),
    module: z.string().optional(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
]);

const VIZ_OUTPUT = '.agents/knowledge/viz.html';

/** `.configs/vulcan.config.*` - strict: an unknown key is a typo, and a typo is an error. */
export const VULCAN_CONFIG_SCHEMA = z.strictObject({
  /** The project's name in the manifest and in every atlas result; default: the root package name, unscoped. */
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  agents: z.array(CODING_AGENT).default([CodingAgents.CLAUDE]),
  rules: z.record(z.string().regex(ConfigConstants.RULE_ID_PATTERN), z.string()).default({}),
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
      coverage: z.array(z.strictObject({ name: z.string(), path: z.string() })).default([]),
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
      /** The `packages` alias for one release: directory to npm name, in release order. */
      packages: z.record(z.string(), z.string()).optional(),
      releaseCommit: RELEASE_TEMPLATE.default('[#<issue>] chore(<dir>): release v<version>'),
      tagPattern: RELEASE_TEMPLATE.default('<dir>-v<version>'),
      sources: z
        .array(
          z.strictObject({
            name: z.string(),
            repo: z.string(),
            ref: z.string().default('develop'),
          }),
        )
        .default([]),
      legacyTagPrefixes: z.array(z.string()).optional(),
      /** Tags neither read nor checked (globs) - an old layout's tags. */
      ignoreTags: z.array(z.string()).optional(),
      typescriptFrom: z.string().optional(),
    })
    .default({
      releaseCommit: '[#<issue>] chore(<dir>): release v<version>',
      tagPattern: '<dir>-v<version>',
      sources: [],
    }),
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
});

export type VulcanConfig = z.input<typeof VULCAN_CONFIG_SCHEMA>;
export type TResolvedConfig = z.output<typeof VULCAN_CONFIG_SCHEMA>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfig): VulcanConfig => config;
