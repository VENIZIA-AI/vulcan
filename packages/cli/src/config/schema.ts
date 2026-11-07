import { z } from 'zod';
import { LayoutFolder } from '../common/layout-folder.ts';
import { DOCTOR_SCHEMA } from '../doctor/schema.ts';
import { GuardDecisions } from '../hooks/common/constants.ts';
import { OWNER_SCHEMA } from '../owner/schema.ts';
import { AgentSignaturePolicies } from '../commit/common/index.ts';
import type { TAgentSignaturePolicy } from '../commit/common/index.ts';
import { SubjectShape } from '../commit/subject.ts';
import { BoardServe } from '../board/common/constants.ts';
import { ProjectKey } from '../events/project-key.ts';
import { ThemeTokens } from '../theme/index.ts';
import { ProjectTheme } from '../visualize/theme.ts';
import { BoardLogo } from '../board/logo.ts';
import { BOARD_AGENTS } from '../board/schema.ts';
import { EventRetention } from '../events/retention.ts';
import { EventSettings } from '../events/settings.ts';
import {
  CodingAgents,
  ConfigConstants,
  HookEvents,
  LibraryKinds,
  PackageKinds,
  TemplatePlaceholders,
} from './common/index.ts';

const CODING_AGENT = z.string().refine((value) => CodingAgents.isValid(value), {
  message: `one of: ${[...CodingAgents.SCHEME_SET].join(', ')}`,
});
const HOOK_EVENT = z.string().refine((value) => HookEvents.isValid(value), {
  message: `one of: ${[...HookEvents.SCHEME_SET].join(', ')}`,
});

/** An ed25519 public key as `atlas index keygen` prints it: the base64 of its 32 raw bytes, nothing else. */
const INDEX_PUBLIC_KEY = z.string().refine(
  (value) => {
    const raw = Buffer.from(value, 'base64');

    return raw.length === 32 && raw.toString('base64') === value;
  },
  { message: 'the public key `atlas index keygen` prints: the base64 of 32 bytes' },
);

const compiles = (value: string): boolean => {
  try {
    return new RegExp(value) instanceof RegExp;
  } catch {
    return false;
  }
};

/** A command the project says is a database write (V-W-02) or a deploy (V-W-03): guard-writes asks when its pattern matches. */
const GUARD_COMMAND = z.strictObject({
  /** Which rule the command falls under: `V-W-02` for a database write, `V-W-03` for a deploy. */
  rule: z.enum(['V-W-02', 'V-W-03']),
  /** Short name of the action, shown when guard-writes asks; 1 to 120 characters. */
  what: z.string().min(1).max(120),
  /** JavaScript regular expression, 1 to 500 characters, matched against a shell command; guard-writes asks when it matches. */
  pattern: z
    .string()
    .min(1)
    .max(500)
    .refine(compiles, { message: 'a regular expression (JavaScript syntax)' }),
  /** `true` matches `pattern` without regard to case; default: case-sensitive. */
  ignoreCase: z.boolean().optional(),
});

/** A branch a plain `git push` asks about: a name, with `*` for any run of characters. */
const PUSH_TARGET = z
  .string()
  .regex(/^[A-Za-z0-9._/*-]+$/, { message: 'a branch name, with * for any run of characters' });

/** An import prefix: the start of a specifier, ending in a slash (`@/`, `~/`). */
const GRAPH_ALIAS_PREFIX = z
  .string()
  .regex(/^[^\s]+\/$/, 'an alias prefix ends with a slash, for example "@/"');
/** The folder an alias leads to, from the importing package: relative to the package, never climbing. */
const GRAPH_ALIAS_FOLDER = z
  .string()
  .refine(
    (value) => !value.startsWith('/') && !value.split('/').includes('..'),
    'a folder of the package, from its root',
  );

/** A key that was removed: optional, and refused when present with the key and what to do, instead of a bare "unrecognized key". */
const REMOVED_OKF_KEY = (opts: { fix: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({ code: 'custom', message: `removed: ${opts.fix}` });
    })
    .optional();

/** A layout folder: 1 to 4 plain segments, never climbing, never absolute. */
const LAYOUT_FOLDER = z.string().superRefine((value, context) => {
  const problem = LayoutFolder.layoutFolderProblem({ folder: value });

  if (problem !== undefined) {
    context.addIssue({ code: 'custom', message: problem });
  }
});

/** One folder, or a list of them: a side whose apps are grouped keeps each group's folder. */
const LAYOUT_VALUE = z.union([LAYOUT_FOLDER, z.array(LAYOUT_FOLDER).min(1)]);

/** The bounds of `atlas.limits.download`: the ones atlas reads the value within; outside them it keeps its default. */
const MIN_DOWNLOAD_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

/** A source repository atlas will not give to git: an `http://` or `git://` URL (clear text), or a `scheme::` remote helper (it runs a command). */
const SOURCE_TRANSPORT = /^(?:(http|git):\/\/|[a-z][a-z0-9+.-]*::)/i;

/** An npm package name, lower case: the pattern and the length atlas applies to every package name of the manifest. */
const NPM_NAME_PATTERN = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const NPM_NAME_MAX_LENGTH = 214;

const NPM_PACKAGE_NAME = z.string().superRefine((value, context) => {
  if (value.length > NPM_NAME_MAX_LENGTH || !NPM_NAME_PATTERN.test(value)) {
    context.addIssue({
      code: 'custom',
      message: `package name '${value}' is not an npm package name: npm names are lower case (a to z, digits, . _ ~ -) with an optional @scope/, at most ${NPM_NAME_MAX_LENGTH} characters, and atlas refuses the manifest otherwise`,
    });
  }
});

/** A name that holds a letter or a digit: an entry of only punctuation or spaces would match everything. */
const AGENT_NAME = z
  .string()
  .regex(/[\p{L}\p{N}]/u, { message: 'a name with at least one letter or digit' });

const PROJECT_PACKAGE = z.strictObject({
  /** Unique key of the package, not necessarily its folder name; lower case letters, digits, `.` and `-`, starting with a letter or digit. */
  dir: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  /** The npm package name: lower case, optional `@scope/`, at most 214 characters. */
  name: NPM_PACKAGE_NAME,
  /** Where the package lives, from the root; default `packages/<dir>`. */
  path: z.string().optional(),
  /** Extra names accepted as the `<dir>` of a release tag; default `[]`. */
  aliases: z.array(z.string()).default([]),
  /** `true` marks a package that is gone but whose releases stay readable; its path may be reused. Default `false`. */
  retired: z.boolean().default(false),
  /** A library a preset made lives anywhere a workspace glob covers; absent means an app or a plain package. */
  kind: z.enum([PackageKinds.APP, PackageKinds.LIB]).optional(),
  /** Which preset kind made a library; absent means the `lib` kind. */
  presetKind: z.enum([LibraryKinds.LIB, LibraryKinds.SHARED]).optional(),
});

/** A path as a key: no leading `./`, no trailing slash. */
const pathKeyOf = (opts: { path: string }): string =>
  opts.path.replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * `dir` is a unique KEY (it need not be the directory name - set `path` for that), so two packages
 * whose directories are both called `core` are `backends-core` and `kits-core`. A repeated key, name or
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
 * A release template: `<dir>` is the package DIRECTORY - the `packages` key,
 * never the npm name (`packages/core-server` published as `@acme/server` tags `core-server-v1.2.0`); `<version>` is the
 * version; `<issue>` an issue number. Every other character is literal. When matching a commit, a
 * leading `[#<issue>] ` is optional and a trailing ` [<mode>]` is tolerated. A release train that
 * tags once leaves `<dir>` out (`v<version>`).
 */
const RELEASE_TEMPLATE = z
  .string()
  .refine((value) => value.includes('<version>'), {
    message: 'a template with <version> (and <dir> for per-package releases)',
  })
  .superRefine((value, context) => {
    const unknown = TemplatePlaceholders.unknownIn({ template: value });

    if (unknown.length > 0) {
      context.addIssue({
        code: 'custom',
        message: TemplatePlaceholders.problemOf({ unknown }),
      });
    }
  });

/** A renderer by id: a built-in, or a project module (`module`); a bare string is the id alone. */
const OKF_RENDERER = z.union([
  z.string().transform((id) => ({ id, options: {} })),
  z.strictObject({
    /** Name of the renderer: a built-in, or the identifier a project module registers. */
    id: z.string(),
    /** Path of the project module that exports the renderer; absent means a built-in. */
    module: z.string().optional(),
    /** Options passed to the renderer; default `{}`. */
    options: z.record(z.string(), z.unknown()).default({}),
  }),
]);

/** A colour of a design token: six-digit hex, or eight-digit with an alpha channel for lines and soft text. */
const TOKEN_COLOUR = z.string().regex(ThemeTokens.COLOUR, 'a hex colour like #8a5a20');

/** `.configs/vulcan.config.*` - strict: an unknown key is a typo, and a typo is an error. */
export const VULCAN_CONFIG_SCHEMA = z.strictObject({
  /** The project's name in the manifest and in every atlas result; default: the root package name, unscoped. */
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  /** The project's flow key: a flow is named `VULZ-<key>-<number>`, and VULCAN gives the number. Set once, when the project starts. */
  project: z
    .strictObject({ key: z.string().regex(ProjectKey.PATTERN, ProjectKey.MESSAGE) })
    .optional(),
  /** The project's suggested agents; each developer's own choice lives in `.agents/vulcan.local.json`. */
  agents: z.array(CODING_AGENT).optional(),
  /** Choice of each base rule slot, keyed by rule ID (for example `V-W-01`) to the option picked; default `{}`. */
  rules: z.record(z.string().regex(ConfigConstants.RULE_ID_PATTERN), z.string()).default({}),
  /** The folders `vulcan init` and `add` put apps in, as the user named them. */
  layout: z
    .strictObject({
      /** Folder, or list of folders, for backend apps. */
      backend: LAYOUT_VALUE.optional(),
      /** Folder, or list of folders, for frontend apps. */
      frontend: LAYOUT_VALUE.optional(),
      /** Folder, or list of folders, for code shared between apps. */
      shared: LAYOUT_VALUE.optional(),
      /** Folders the layout does not manage (docs, third-party code, tests): packages there are allowed, never targeted by `add`, never guarded. */
      other: LAYOUT_VALUE.optional(),
    })
    .superRefine((layout, context) => {
      for (const problem of LayoutFolder.layoutOverlapProblems({ layout })) {
        context.addIssue({ code: 'custom', message: problem });
      }
    })
    .optional(),
  /** The presets this project's apps came from (`init` and `add` record them), as `--preset` takes them back. */
  presets: z
    .array(
      z.strictObject({
        /** What was given to `--preset`. */
        spec: z.string().min(1),
        /** Side of the preset's app kind: `backend` or `frontend`. */
        side: z.enum(['backend', 'frontend']),
        /** The app kind's one-sentence summary. */
        summary: z.string(),
        /** The summary of the preset's lib kind, when it ships one. */
        lib: z.string().optional(),
        /** The summary of the preset's shared kind, when it ships one. */
        shared: z.string().optional(),
      }),
    )
    .optional(),
  /** The project's packages in release order; okf, atlas, make and release read this one list. */
  packages: z.array(PROJECT_PACKAGE).superRefine(checkPackagesUnique).default([]),
  /** Where the project keeps its knowledge bundle, wiki, changelogs and sync map; read by okf, doctor and the knowledge-sync skill. */
  knowledge: z
    .strictObject({
      /** Folder of the knowledge bundle (the OKF concepts); default `.agents/knowledge`. */
      bundle: z.string().default(ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE),
      /** Folder of the wiki content; absent means the project has none. */
      wiki: z.string().optional(),
      /** Folder of the changelog files; absent means the project has none. */
      changelogs: z.string().optional(),
      /** The knowledge-sync skill's map of code areas to concepts. */
      syncAreas: z.string().optional(),
    })
    .default({ bundle: ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE }),
  /** Settings of okf, the knowledge bundle tool: renderers, regions, coverage axes and the brand. */
  okf: z
    .strictObject({
      /** Renderers the project uses, each a built-in id or an object with a module; default `[]`. */
      renderers: z.array(OKF_RENDERER).default([]),
      /** Generated blocks in markdown files, each binding a region `id` and `file` to a `renderer`; default `[]`. */
      regions: z
        .array(z.strictObject({ id: z.string(), file: z.string(), renderer: z.string() }))
        .default([]),
      /** `exclude`: globs from the root dropped from this axis; `denylist`: directory names dropped from this axis only. */
      coverage: z
        .array(
          z.strictObject({
            /** Unique name of the coverage axis. */
            name: z.string(),
            /** Directory or pattern the axis scans. */
            path: z.string(),
            /** Globs from the root dropped from this axis; default `[]`. */
            exclude: z.array(z.string()).default([]),
            /** Directory names dropped from this axis only; default `[]`. */
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
      /** How the project's name is written in prose, for the brand rule of `okf check`; absent means the root package name without scope, upper-cased. */
      brand: z.string().optional(),
      /** Removed with `vulcan x okf viz`: the key is refused with what to do. */
      viz: REMOVED_OKF_KEY({
        fix: 'delete this key; `vulcan x okf viz` and `make okf-viz` are gone with no replacement, and the brand it carried is now `okf.brand`',
      }),
      /** Removed with the explorer, the only thing that read it. */
      sections: REMOVED_OKF_KEY({ fix: 'delete this key; only the removed explorer read it' }),
    })
    .default({
      renderers: [],
      regions: [],
      coverage: [],
      denylist: [],
      contents: { files: ['AGENTS.md', '.agents/rules.md'] },
    }),
  /** Settings of atlas: release tag layout, the sources it indexes, ignored tags, the signing keys of the published index and prebuilt downloads. */
  atlas: z
    .strictObject({
      /** Template of a release tag; must hold `<version>`, and `<dir>` for per-package tags. Default `<dir>-v<version>`. */
      tagPattern: RELEASE_TEMPLATE.default('<dir>-v<version>'),
      /**
       * Templates of an earlier tag layout that are still releases: atlas and the changelog check read a tag
       * through `tagPattern` first and then through each of these, so a rename of the tags keeps the old
       * releases. Unlike `ignoreTags`, a tag matched here counts as a release.
       */
      legacyTagPatterns: z.array(RELEASE_TEMPLATE).optional(),
      /** Repositories atlas indexes besides this one, each with a `name`, a `repo` and a `ref`; default `[]`. */
      sources: z
        .array(
          z
            .strictObject({
              /** Identifier of the source in atlas results: letters, digits, `_`, `.` and `-`, starting with a letter or a digit. */
              name: z
                .string()
                .regex(
                  /^[A-Za-z0-9][\w.-]*$/,
                  'a name of letters, digits, _ . and -, starting with a letter or a digit',
                ),
              /** GitHub repository of the source, as `owner/repo`. */
              repo: z.string().refine((value) => !value.trimStart().startsWith('-'), {
                message: "a repository, not an option: it must not start with '-'",
              }),
              /** Branch, tag or commit the source is indexed at; default `develop`. */
              ref: z
                .string()
                .refine((value) => !value.trimStart().startsWith('-'), {
                  message: "a ref, not an option: it must not start with '-'",
                })
                .default('develop'),
              /** `installed` (default): the docs are read at the tag of the newest installed package; `ref`: at `ref`. */
              pin: z.enum(['installed', 'ref']).optional(),
            })
            .superRefine((source, context) => {
              const refused = SOURCE_TRANSPORT.exec(source.repo.trim());

              if (refused !== null) {
                context.addIssue({
                  code: 'custom',
                  path: ['repo'],
                  message: `source '${source.name}': the repository uses ${refused[1] === undefined ? 'a remote-helper URL, which runs a command' : `${refused[1].toLowerCase()}://, which is clear text`} - use https or ssh`,
                });
              }
            }),
        )
        .default([]),
      /** Tags neither read nor checked (globs) - an old layout's tags. */
      ignoreTags: z.array(z.string()).optional(),
      /**
       * The prebuilt atlas index this repository publishes: the public keys (any one may have signed a
       * pair) that a project reading this one as a source checks the signature against. Rotation is a
       * new list; a pair signed by a key no longer listed is not used.
       */
      index: z.strictObject({ keys: z.array(INDEX_PUBLIC_KEY).default([]) }).optional(),
      /** `false`: atlas never downloads a prebuilt index for a source this project reads; the default is to. */
      prebuilt: z.boolean().optional(),
      /** The sizes atlas holds to when it fetches. */
      limits: z
        .strictObject({
          /**
           * The most bytes atlas reads of one tarball it downloads (a source's commit from GitHub, an npm package
           * for its declarations); a larger one is refused and nothing is kept. An integer from 1 MiB to 1 GiB;
           * default 128 MiB.
           */
          download: z.number().int().min(MIN_DOWNLOAD_BYTES).max(MAX_DOWNLOAD_BYTES).optional(),
        })
        .optional(),
    })
    .default({
      tagPattern: '<dir>-v<version>',
      sources: [],
    }),
  /** Removed with the guard that read it: the key is refused with what to do. */
  remoteHosts: REMOVED_OKF_KEY({
    fix: "the guard that read this key is deleted; delete the key and the personal file `.agents/hooks/trusted-hosts.local`, the host's own permission rules cover network access",
  }),
  /**
   * The colour the project is known by: `vulcan visualize` takes the accent of its pages from here (the spec's own
   * `accent` wins). `accent` is the colour for marks and fills; `accentDark` is the same on dark grounds (derived
   * when absent); `accentText` is a darker accent for text, when `accent` is too light to be read as text.
   * `vulcan sync` copies it to the manifest, where the generator reads it.
   */
  theme: z
    .strictObject({
      /** The preset the tokens start from: `venizia` (default) or `slate`; a preset fixes every token and the project changes only what it names. */
      preset: z
        .string()
        .refine((name) => Object.hasOwn(ThemeTokens.PRESETS, name), {
          message: `one of ${Object.keys(ThemeTokens.PRESETS).join(', ')}`,
        })
        .optional(),
      /** Colour for marks and fills, as a six-digit hex such as `#8a5a20`; absent means the preset's accent. */
      accent: z.string().regex(ProjectTheme.HEX, 'a six-digit hex colour like #8a5a20').optional(),
      /** Accent for dark grounds, a six-digit hex such as `#dead6a`; derived from `accent` when absent. */
      accentDark: z
        .string()
        .regex(ProjectTheme.HEX, 'a six-digit hex colour like #dead6a')
        .optional(),
      /** Darker accent for text, a six-digit hex such as `#01579b`; absent means `accent` is used for text too. */
      accentText: z
        .string()
        .regex(ProjectTheme.HEX, 'a six-digit hex colour like #01579b')
        .optional(),
      /** Per-token colours over the preset, keyed by token name: one hex for both modes, or `{ light, dark }`; each pair is checked against WCAG AA. */
      tokens: z
        .record(
          z.string(),
          z.union([
            TOKEN_COLOUR,
            z.strictObject({ light: TOKEN_COLOUR.optional(), dark: TOKEN_COLOUR.optional() }),
          ]),
        )
        .optional(),
      /** The sans font stack for the board, the wiki and the pages; default the preset's. */
      font: z.string().min(1).optional(),
      /** The monospace font stack; default the preset's. */
      mono: z.string().min(1).optional(),
      /** The corner radius: `0`, or a number with `px`, `rem` or `em` such as `4px`; anything else is refused. Default the preset's. */
      radius: z.string().min(1).optional(),
    })
    .superRefine((theme, context) => {
      const resolved = ThemeTokens.resolve({ theme });

      if (!resolved.ok) {
        for (const message of resolved.problems) {
          context.addIssue({ code: 'custom', message, path: [] });
        }
      }
    })
    .optional(),
  /**
   * What `vulcan board` calls things. `owner` is who an ask waits on (default: `git config user.name`),
   * `title` the name on the page (default: the project name and "Board"), `logo` a path inside the project to an
   * SVG put on the page (default: none), `agents` an agent name to a face (`bun`, `flame`, `ember`, `rock`,
   * `banana`; any other agent has `bun`). Written to the manifest only when something is set.
   */
  board: z
    .strictObject({
      /** Who an ask waits on; default: `git config user.name`, else `Owner`. */
      owner: z.string().min(1).optional(),
      /** Name on the board page and tab; default: the project name and `Board`. */
      title: z.string().min(1).optional(),
      /** Name in the address of `vulcan board serve`: lowercase, ending in `.localhost`; default `vulz-board.venizia.ai.localhost`. */
      hostname: z
        .string()
        .regex(
          BoardServe.HOSTNAME,
          'a lowercase name that ends in .localhost, such as board.localhost',
        )
        .optional(),
      /** Path inside the project to an `.svg` file shown on the board page, with no leading `/` and no `..` segment; default none. */
      logo: z
        .string()
        .min(1)
        .refine((value) => BoardLogo.isPath({ path: value }), {
          message: 'a path inside the project to an .svg file, with no leading / and no .. segment',
        })
        .optional(),
      /** Faces and roles of the board's agents, keyed by agent name; default `{}`. */
      agents: BOARD_AGENTS.default({}),
    })
    .default({ agents: {} }),
  /** What `vulcan doctor` is told: `privateValues.acknowledged` lists the files that may keep private values, each with a `reason`. */
  doctor: DOCTOR_SCHEMA.default({ privateValues: { acknowledged: [] } }),
  /** Team-shared Claude settings (permissions, env, enabledPlugins...), merged by sync over personal keys. */
  claude: z
    .strictObject({ settings: z.record(z.string(), z.unknown()).default({}) })
    .default({ settings: {} }),
  /** Project hooks, each an `event`, an optional `matcher` and a `command`; `vulcan sync` merges them into the agent settings. Default `[]`. */
  hooks: z
    .array(
      z.strictObject({ event: HOOK_EVENT, matcher: z.string().optional(), command: z.string() }),
    )
    .default([]),
  /** The session-start digest: the rule IDs it repeats as "the rules sessions drop most" - base or the project's own. */
  digest: z
    .strictObject({
      /** Rule IDs the digest repeats as dropped most, each matching the rule ID pattern; default the shipped list of base rules. */
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
   * manages itself: absolute globs, `~` and `$NAME` allowed. `writes.commands` adds the
   * project's own deploy and migrate commands to what guard-writes asks about (a pattern, matched inside
   * compound commands too), and `git.askPush` lists the branches a plain `git push` asks about; `vulcan sync`
   * writes both to the manifest, where the hooks read them, and writes `outside` (when it is `deny`) and
   * `toolOwnedPaths` there too, so a config this VULCAN cannot parse changes no guard. `outside` is what
   * `guard-outside` does with a write outside the project: `ask` (the default) or `deny`. Where the agent runs in an auto mode an ask can be
   * approved without the owner seeing it, so a project that wants the line held sets `deny`.
   */
  guard: z
    .strictObject({
      /** Absolute globs (`~` and `$NAME` allowed) of tool-managed stores, added to the built-in list; default `[]`. */
      toolOwnedPaths: z.array(z.string().min(1)).default([]),
      /** What guard-outside does with a write outside the project: `ask` or `deny`; default `ask`. */
      outside: z.enum([GuardDecisions.ASK, GuardDecisions.DENY]).default(GuardDecisions.ASK),
      /** Write guard list: the project's own deploy and migrate commands; default `[]`. */
      writes: z
        .strictObject({
          /** Removed with the script reading of guard-writes: the key is refused with what to do. */
          trustedScripts: REMOVED_OKF_KEY({
            fix: 'delete this key; guard-writes no longer reads scripts, it asks only for the commands of its table and of guard.writes.commands',
          }),
          /** The project's own deploy and migrate commands guard-writes asks about; default `[]`. */
          commands: z.array(GUARD_COMMAND).default([]),
        })
        .default({ commands: [] }),
      /** Git guard settings; `askPush` lists the branches a plain `git push` asks about, `*` for any run of characters. Default `[]`. */
      git: z.strictObject({ askPush: z.array(PUSH_TARGET).default([]) }).default({ askPush: [] }),
    })
    .default({
      toolOwnedPaths: [],
      outside: GuardDecisions.ASK,
      writes: { commands: [] },
      git: { askPush: [] },
    }),
  /**
   * What `vulcan commit-check` looks for in a commit message, and what `vulcan sync` installs the
   * `commit-msg` hook for, nested by scope. Every check is off until the project turns it on:
   * `message.agent.signature: 'deny'` rejects a trailer or a "generated with" line that names an agent
   * (rule W-00 of a project that has one); `message.agent.names` adds names to the shipped list and
   * `message.agent.allow` lists names never flagged; `message.subject` is the project's own one-line
   * shape. Written to the manifest only when a check is on.
   */
  commit: z
    .strictObject({
      /** Checks on the text of a commit message: the agent signature policy and the subject shape. */
      message: z
        .strictObject({
          /** Rules about agent names in a commit message: signature policy, extra names and allowed names. */
          agent: z
            .strictObject({
              /** Policy for an agent trailer or "generated with" line in a commit message: `allow` or `deny`; default `allow`. */
              signature: z
                .custom<TAgentSignaturePolicy>(
                  (value) => typeof value === 'string' && AgentSignaturePolicies.isValid(value),
                  { message: `one of ${[...AgentSignaturePolicies.SCHEME_SET].join(', ')}` },
                )
                .default(AgentSignaturePolicies.ALLOW),
              /** Agent names added to the shipped list; a co-author or `Generated with` line naming one is flagged under `deny`. Default `[]`. */
              names: z.array(AGENT_NAME).default([]),
              /** Whole co-author names never flagged, for a person who shares a name with an agent; default `[]`. */
              allow: z.array(AGENT_NAME).default([]),
            })
            .default({ signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] }),
          /** The project's own shape for the commit subject line; absent means no subject check. */
          subject: z
            .strictObject({
              /** Regular expression the commit subject must match, 1 or more characters; an invalid expression is rejected. */
              pattern: z
                .string()
                .min(1)
                .superRefine((value, context) => {
                  const error = SubjectShape.patternError({ pattern: value });

                  if (error !== undefined) {
                    context.addIssue({ code: 'custom', message: error });
                  }
                }),
              /** Text shown with the error when a subject does not match `pattern`; absent means none. */
              hint: z.string().min(1).optional(),
            })
            .optional(),
        })
        .default({ agent: { signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] } }),
    })
    .default({
      message: { agent: { signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] } },
    }),
  /**
   * What `vulcan ci affected` treats as touching every package. `affected.global` adds root-relative globs
   * to the shipped list (lockfiles, `bunfig.toml`, root `tsconfig*.json`, `.configs/`, the workflow files);
   * a project cannot remove a shipped one. Written to the manifest only when it is not empty.
   */
  ci: z
    .strictObject({
      /** Which changed files make `vulcan ci affected` treat every package as affected. */
      affected: z
        .strictObject({
          /** Root-relative globs, no leading `/` and no `..` segment, added to the shipped list of files that touch every package; default `[]`. */
          global: z
            .array(
              z
                .string()
                .min(1)
                .refine((glob) => !glob.startsWith('/') && !glob.split('/').includes('..'), {
                  message:
                    'a glob relative to the project root, with no leading / and no .. segment',
                }),
            )
            .default([]),
        })
        .default({ global: [] }),
    })
    .default({ affected: { global: [] } }),
  /**
   * The agent event log: one JSON line per thing an agent did (a session started, a message sent, an
   * owner is needed), summaries only, in `.agents/local/events/<day>.jsonl`. `log: true` makes
   * `vulcan sync` install the Claude Code hooks that write it; `vulcan event add` writes it for any
   * other agent whatever this says. `dir` is an absolute folder that takes the log instead of the
   * project's own, so one coordinator can read the events of sessions in different repositories.
   * Off by default; written to the manifest only when `log` is true or `dir` is set.
   */
  events: z
    .strictObject({
      /** `true` makes `vulcan sync` install the hooks that write the event log; default `false`. */
      log: z.boolean().default(false),
      /** Absolute folder that takes the event log instead of the project's own; absent means the project's `.agents/local/events`. */
      dir: z
        .string()
        .min(1)
        .superRefine((value, context) => {
          const error = EventSettings.dirError({ dir: value });

          if (error !== undefined) {
            context.addIssue({ code: 'custom', message: `dir must be ${error}` });
          }
        })
        .optional(),
      /**
       * How much of the log is kept, as whole day files removed oldest first (today's never): `maxSize` for the
       * folder (`50MB`, `200MB`, `1GB`), `maxFiles` for the day files, `maxAgeDays` for their age. The defaults,
       * when `log` is on, are 50MB, 30 files and 30 days.
       */
      maxSize: z
        .string()
        .refine((value) => EventRetention.parseSize({ text: value }) !== undefined, {
          message: 'a size such as 50MB, 200MB or 1GB',
        })
        .optional(),
      /** Most day files kept in the log; at least 1, default 30 when `log` is on. */
      maxFiles: z.number().int().min(1).optional(),
      /** Oldest age, in days, a day file may reach; at least 1, default 30 when `log` is on. */
      maxAgeDays: z.number().int().min(1).optional(),
    })
    .default({ log: false }),
  /**
   * How `vulcan x atlas graph build` reads the code. `exclude` is globs of tracked files left out; `aliases` maps an import
   * prefix to a folder of the importing package (`{ '@/': 'src/' }`), so `@/x` in `packages/a/src/y.ts` leads to
   * `packages/a/src/x`. An alias not listed is counted as an external import.
   */
  graph: z
    .strictObject({
      /** Globs of tracked files, from the project root, the graph leaves out. */
      exclude: z.array(z.string().min(1)).default([]),
      /** An import prefix ending in a slash, mapped to a folder of the importing package. */
      aliases: z.record(GRAPH_ALIAS_PREFIX, GRAPH_ALIAS_FOLDER).default({}),
    })
    .default({ exclude: [], aliases: {} }),
  /**
   * What `vulcan` keeps tidy in `.agents/local/` by itself. `autoClean` (default true) lets the session-start hook, at
   * most once a day, remove the safe part: stale `tmp/`, browser leftovers older than an hour, event files past their
   * limits, and release candidates whose version is tagged. It never removes a worktree or a clone.
   */
  local: z
    .strictObject({
      /** `true` lets the session-start hook clean the safe part of `.agents/local/` at most once a day; default `true`. */
      autoClean: z.boolean().default(true),
      /**
       * A folder of the project, from its root, for the temporary files of a session (default `.agents/local/tmp`). A
       * browser puts a socket below it and fails past 107 characters of path, so a deep checkout can name a short one (`t`).
       * Written like a layout folder: 1 to 4 plain lower-case segments, never absolute, never climbing. `vulcan sync`
       * creates it, gitignores it and points the launch file at it.
       */
      tmp: LAYOUT_FOLDER.optional(),
    })
    .default({ autoClean: true }),
});

/** What a project writes in `.configs/vulcan.config.mts`: every key optional or defaulted, unknown keys refused. */
export type VulcanConfig = z.input<typeof VULCAN_CONFIG_SCHEMA>;
/** The config as the CLI reads it: every default filled in. */
export type TResolvedConfig = z.output<typeof VULCAN_CONFIG_SCHEMA>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfig): VulcanConfig => config;
