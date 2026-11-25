/**
 * A frozen copy of the config schema as it stood before it was split into sections (issue #1112), with the doctor and
 * owner sections inlined: the pin that `schema-pin.test.ts` compares the live schema to.
 */
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { SiteUrl } from '@venizia/vulcan-atlas';
import { LayoutFolder } from '../../common/layout-folder.ts';
import { PrivateValueKinds } from '../../doctor/common/constants.ts';
import type { TPrivateValueKind } from '../../doctor/common/types.ts';
import { GuardDecisions } from '../../hooks/common/constants.ts';
import { LoaderEnvironment } from '../../hooks/loader-environment.ts';
import { LayoutConstants } from '../../layout/common/constants.ts';
import { OwnerConstants, OwnerEnforcement, OwnerSections } from '../../owner/constants.ts';
import { OWNER_LABEL_SET } from '../../owner/schema.ts';
import { RulePacks } from '../../rules/packs.ts';
import { AgentSignaturePolicies } from '../../commit/common/index.ts';
import type { TAgentSignaturePolicy } from '../../commit/common/index.ts';
import { SubjectShape } from '../../commit/subject.ts';
import { BoardConstants, BoardServe, ProviderTypes } from '../../board/common/constants.ts';
import { ProjectKey } from '../../events/project-key.ts';
import { ThemeTokens } from '../../theme/index.ts';
import { ProjectTheme } from '../../visualize/theme.ts';
import { BoardLogo } from '../../board/logo.ts';
import { BOARD_AGENTS } from '../../board/schema.ts';
import { EventRetention } from '../../events/retention.ts';
import { EventSettings } from '../../events/settings.ts';
import {
  CodingAgents,
  ConfigConstants,
  LibraryKinds,
  PackageKinds,
  TemplatePlaceholders,
} from '../../config/common/index.ts';

const KIND = z.custom<TPrivateValueKind>(
  (value) => typeof value === 'string' && PrivateValueKinds.isValid(value),
  { message: `one of ${PrivateValueKinds.values().join(', ')}` },
);

const ACKNOWLEDGEMENT = z.strictObject({
  path: z
    .string()
    .min(1)
    .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), {
      message: 'a glob relative to the repo root, without ..',
    }),
  kinds: z.array(KIND).min(1).optional(),
  reason: z.string().trim().min(1),
  standing: z.boolean().optional(),
});

const LAYOUT = z.strictObject({
  maxLines: z.number().int().positive().default(LayoutConstants.DEFAULT_MAX_LINES),
  minSubfolders: z.number().int().positive().default(LayoutConstants.DEFAULT_MIN_SUBFOLDERS),
  pluralAllow: z.array(z.string().min(1)).default([]),
  generated: z.array(z.string().min(1)).default([]),
});

const DOCTOR_SCHEMA = z.strictObject({
  privateValues: z
    .strictObject({ acknowledged: z.array(ACKNOWLEDGEMENT).default([]) })
    .default({ acknowledged: [] }),
  layout: LAYOUT.prefault({}),
});

const TEXT = z.string().regex(OwnerConstants.LABEL_PATTERN, {
  message: 'one line of at most 80 characters, with no backtick, pipe or quote',
});
const LANGUAGE = z.string().regex(OwnerConstants.LANGUAGE_PATTERN, {
  message: 'a language code such as en or pt-BR',
});
const choice = (opts: { isValid: (value: string) => boolean; set: Iterable<string> }) =>
  z.string().refine((value) => opts.isValid(value), {
    message: `one of: ${[...opts.set].join(', ')}`,
  });

const SECTION = choice({
  isValid: (value) => OwnerSections.isValid(value),
  set: OwnerSections.values(),
});
const ENFORCE = choice({
  isValid: (value) => OwnerEnforcement.isValid(value),
  set: OwnerEnforcement.values(),
});
const REMOVED_KEY = (opts: { fix: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({ code: 'custom', message: `removed: ${opts.fix}` });
    })
    .optional();

const DEFAULTS = OwnerConstants.DEFAULT_LABELS;

const OWNER_SCHEMA = z
  .strictObject({
    language: LANGUAGE.default(OwnerConstants.DEFAULT_LANGUAGE),
    report: z
      .strictObject({
        shape: z.array(SECTION).min(1).default(OwnerConstants.DEFAULT_SHAPE),
        minimapColumns: z.tuple([TEXT, TEXT, TEXT]).default(DEFAULTS.minimapColumns),
        status: OWNER_LABEL_SET.shape.status.default(DEFAULTS.status),
        labels: OWNER_LABEL_SET.shape.labels.default(DEFAULTS.labels),
        headlineMaxSentences: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(OwnerConstants.DEFAULT_HEADLINE_MAX_SENTENCES),
        absolutePaths: z.boolean().default(true),
        enforce: ENFORCE.default(OwnerEnforcement.ADVISE),
        claimWords: REMOVED_KEY({ fix: 'delete this key; the reply check that read it is gone' }),
        shortReplyWords: REMOVED_KEY({
          fix: 'delete this key; the reply check that read it is gone',
        }),
      })
      .prefault({}),
  })
  .prefault({});

const CODING_AGENT = z.string().refine((value) => CodingAgents.isValid(value), {
  message: `one of: ${[...CodingAgents.SCHEME_SET].join(', ')}`,
});

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

const GUARD_COMMAND = z.strictObject({
  rule: z.enum(['V-W-02', 'V-W-03']),
  what: z.string().min(1).max(120),
  pattern: z
    .string()
    .min(1)
    .max(500)
    .refine(compiles, { message: 'a regular expression (JavaScript syntax)' }),
  ignoreCase: z.boolean().optional(),
});

const PUSH_TARGET = z
  .string()
  .regex(/^[A-Za-z0-9._/*-]+$/, { message: 'a branch name, with * for any run of characters' });

const REMOVED_OKF_KEY = (opts: { fix: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({ code: 'custom', message: `removed: ${opts.fix}` });
    })
    .optional();

const LAYOUT_FOLDER = z.string().superRefine((value, context) => {
  const problem = LayoutFolder.layoutFolderProblem({ folder: value });

  if (problem !== undefined) {
    context.addIssue({ code: 'custom', message: problem });
  }
});

const LAYOUT_VALUE = z.union([LAYOUT_FOLDER, z.array(LAYOUT_FOLDER).min(1)]);

const MIN_DOWNLOAD_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

const SOURCE_TRANSPORT = /^(?:(http|git):\/\/|[a-z][a-z0-9+.-]*::)/i;

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

const AGENT_NAME = z
  .string()
  .regex(/[\p{L}\p{N}]/u, { message: 'a name with at least one letter or digit' });

const PROJECT_PACKAGE = z.strictObject({
  dir: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  name: NPM_PACKAGE_NAME,
  path: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  retired: z.boolean().default(false),
  kind: z.enum([PackageKinds.APP, PackageKinds.LIB]).optional(),
  presetKind: z.enum([LibraryKinds.LIB, LibraryKinds.SHARED]).optional(),
});

const pathKeyOf = (opts: { path: string }): string =>
  opts.path.replace(/^\.\//, '').replace(/\/+$/, '');

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

const OKF_RENDERER = z.union([
  z.string().transform((id) => ({ id, options: {} })),
  z.strictObject({
    id: z.string(),
    module: z.string().optional(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
]);

const TOKEN_COLOUR = z.string().regex(ThemeTokens.COLOUR, 'a hex colour like #8a5a20');

export const FROZEN_CONFIG_SCHEMA = z.strictObject({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  project: z
    .strictObject({ key: z.string().regex(ProjectKey.PATTERN, ProjectKey.MESSAGE) })
    .optional(),
  agents: z.array(CODING_AGENT).optional(),
  rules: z.record(z.string().regex(ConfigConstants.RULE_ID_PATTERN), z.string()).default({}),
  packs: z
    .array(
      z.string().refine((name) => RulePacks.names().includes(name), {
        error: () => `a rule pack VULCAN ships: ${RulePacks.names().join(', ')}`,
      }),
    )
    .default([]),
  remove: z
    .record(
      z.string().refine((key) => Object.hasOwn(ConfigConstants.LAYERED_ARRAYS, key), {
        error: () =>
          `an array that shipped defaults can add to: ${Object.keys(ConfigConstants.LAYERED_ARRAYS).join(', ')}`,
      }),
      z.array(z.string().min(1)),
    )
    .optional(),
  layout: z
    .strictObject({
      backend: LAYOUT_VALUE.optional(),
      frontend: LAYOUT_VALUE.optional(),
      shared: LAYOUT_VALUE.optional(),
      other: LAYOUT_VALUE.optional(),
    })
    .superRefine((layout, context) => {
      for (const problem of LayoutFolder.layoutOverlapProblems({ layout })) {
        context.addIssue({ code: 'custom', message: problem });
      }
    })
    .optional(),
  presets: z
    .array(
      z.strictObject({
        spec: z.string().min(1),
        side: z.enum(['backend', 'frontend']),
        summary: z.string(),
        lib: z.string().optional(),
        shared: z.string().optional(),
      }),
    )
    .optional(),
  packages: z.array(PROJECT_PACKAGE).superRefine(checkPackagesUnique).default([]),
  knowledge: z
    .strictObject({
      bundle: z.string().default(ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE),
      wiki: z.string().optional(),
      changelogs: z.string().optional(),
      migrationFrom: z
        .string()
        .regex(/^(?:\d{4}-\d{2}-\d{2}|\d+\.\d+\.\d+)$/)
        .optional(),
      codemodCommand: z
        .array(z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i))
        .min(1)
        .optional(),
      datedUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      siteUrl: z
        .string()
        .transform((value, context) => {
          const parsed = SiteUrl.parse({ value });

          if ('problem' in parsed) {
            context.addIssue({ code: 'custom', message: parsed.problem });

            return z.NEVER;
          }

          return parsed.href;
        })
        .optional(),
    })
    .default({ bundle: ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE }),
  okf: z
    .strictObject({
      renderers: z.array(OKF_RENDERER).default([]),
      regions: z
        .array(z.strictObject({ id: z.string(), file: z.string(), renderer: z.string() }))
        .default([]),
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
      denylist: z.array(z.string()).default([]),
      contents: z
        .strictObject({ files: z.array(z.string()).default(['AGENTS.md', '.agents/rules.md']) })
        .default({ files: ['AGENTS.md', '.agents/rules.md'] }),
      brand: z.string().optional(),
      viz: REMOVED_OKF_KEY({
        fix: 'delete this key; `vulcan okf viz` and `make okf-viz` are gone with no replacement, and the brand it carried is now `knowledge.okf.brand`',
      }),
      sections: REMOVED_OKF_KEY({ fix: 'delete this key; only the removed explorer read it' }),
    })
    .default({
      renderers: [],
      regions: [],
      coverage: [],
      denylist: [],
      contents: { files: ['AGENTS.md', '.agents/rules.md'] },
    }),
  atlas: z
    .strictObject({
      tagPattern: RELEASE_TEMPLATE.default('<dir>-v<version>'),
      legacyTagPatterns: z.array(RELEASE_TEMPLATE).optional(),
      sources: z
        .array(
          z
            .strictObject({
              name: z
                .string()
                .regex(
                  /^[A-Za-z0-9][\w.-]*$/,
                  'a name of letters, digits, _ . and -, starting with a letter or a digit',
                ),
              repo: z.string().refine((value) => !value.trimStart().startsWith('-'), {
                message: "a repository, not an option: it must not start with '-'",
              }),
              ref: z
                .string()
                .refine((value) => !value.trimStart().startsWith('-'), {
                  message: "a ref, not an option: it must not start with '-'",
                })
                .default('develop'),
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
      ignoreTags: z.array(z.string()).optional(),
      index: z.strictObject({ keys: z.array(INDEX_PUBLIC_KEY).default([]) }).optional(),
      prebuilt: z.boolean().optional(),
      limits: z
        .strictObject({
          download: z.number().int().min(MIN_DOWNLOAD_BYTES).max(MAX_DOWNLOAD_BYTES).optional(),
        })
        .optional(),
    })
    .default({
      tagPattern: '<dir>-v<version>',
      sources: [],
    }),
  theme: z
    .strictObject({
      preset: z
        .string()
        .refine((name) => Object.hasOwn(ThemeTokens.PRESETS, name), {
          message: `one of ${Object.keys(ThemeTokens.PRESETS).join(', ')}`,
        })
        .optional(),
      accent: z.string().regex(ProjectTheme.HEX, 'a six-digit hex colour like #8a5a20').optional(),
      accentDark: z
        .string()
        .regex(ProjectTheme.HEX, 'a six-digit hex colour like #dead6a')
        .optional(),
      accentText: z
        .string()
        .regex(ProjectTheme.HEX, 'a six-digit hex colour like #01579b')
        .optional(),
      tokens: z
        .record(
          z.string(),
          z.union([
            TOKEN_COLOUR,
            z.strictObject({ light: TOKEN_COLOUR.optional(), dark: TOKEN_COLOUR.optional() }),
          ]),
        )
        .optional(),
      font: z.string().min(1).optional(),
      mono: z.string().min(1).optional(),
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
  board: z
    .strictObject({
      owner: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      hostname: z
        .string()
        .regex(
          BoardServe.HOSTNAME,
          'a lowercase name that ends in .localhost, such as board.localhost',
        )
        .optional(),
      logo: z
        .string()
        .min(1)
        .refine((value) => BoardLogo.isPath({ path: value }), {
          message: 'a path inside the project to an .svg file, with no leading / and no .. segment',
        })
        .optional(),
      agents: BOARD_AGENTS.default({}),
    })
    .default({ agents: {} }),
  provider: z
    .strictObject({
      type: z.enum([ProviderTypes.GITHUB, ProviderTypes.GITLAB]).default(ProviderTypes.GITHUB),
      host: z
        .string()
        .regex(
          BoardConstants.GITLAB_HOST,
          'a bare host name such as gitlab.example.com, with an optional :port, no scheme, path or credentials',
        )
        .optional(),
    })
    .refine((provider) => provider.host === undefined || provider.type === ProviderTypes.GITLAB, {
      message: 'host is only for type "gitlab"',
      path: ['host'],
    })
    .default({ type: ProviderTypes.GITHUB }),
  doctor: DOCTOR_SCHEMA.prefault({}),
  claude: z
    .strictObject({
      settings: z
        .record(z.string(), z.unknown())
        .superRefine((settings, context) => {
          const env = settings['env'];

          if (typeof env !== 'object' || env === null || Array.isArray(env)) {
            return;
          }

          for (const name of Object.keys(env).filter((key) => /^VULCAN_GUARD/.test(key))) {
            context.addIssue({
              code: 'custom',
              message: `${name} is the owner's choice and belongs in the environment that launches the agent, not in the project's Claude settings, which an agent can edit`,
            });
          }

          for (const name of Object.keys(env).filter((key) => LoaderEnvironment.isStripped(key))) {
            context.addIssue({
              code: 'custom',
              message: `${name} changes what bun loads before a guard runs, and every hook inherits the \`env\` of these settings: it is refused here, and the hooks remove it from their own environment`,
            });
          }
        })
        .default({}),
    })
    .default({ settings: {} }),
  digest: z
    .strictObject({
      oftenDropped: z.array(z.string().regex(ConfigConstants.RULE_ID_PATTERN)).default([]),
    })
    .default({ oftenDropped: [] }),
  owner: OWNER_SCHEMA,
  guard: z
    .strictObject({
      toolOwnedPaths: z.array(z.string().min(1)).default([]),
      outside: z.enum([GuardDecisions.ASK, GuardDecisions.DENY]).default(GuardDecisions.ASK),
      asks: z.enum([GuardDecisions.ASK, GuardDecisions.DENY]).default(GuardDecisions.ASK),
      writes: z
        .strictObject({
          trustedScripts: REMOVED_OKF_KEY({
            fix: 'delete this key; guard-writes no longer reads scripts, it asks only for the commands of its table and of guard.writes.commands',
          }),
          commands: z.array(GUARD_COMMAND).default([]),
        })
        .default({ commands: [] }),
      git: z.strictObject({ askPush: z.array(PUSH_TARGET).default([]) }).default({ askPush: [] }),
      runners: z
        .strictObject({
          allow: z
            .array(z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/))
            .default([]),
        })
        .default({ allow: [] }),
    })
    .default({
      toolOwnedPaths: [],
      outside: GuardDecisions.ASK,
      asks: GuardDecisions.ASK,
      writes: { commands: [] },
      git: { askPush: [] },
      runners: { allow: [] },
    }),
  commit: z
    .strictObject({
      message: z
        .strictObject({
          agent: z
            .strictObject({
              signature: z
                .custom<TAgentSignaturePolicy>(
                  (value) => typeof value === 'string' && AgentSignaturePolicies.isValid(value),
                  { message: `one of ${AgentSignaturePolicies.values().join(', ')}` },
                )
                .default(AgentSignaturePolicies.ALLOW),
              names: z.array(AGENT_NAME).default([]),
              allow: z.array(AGENT_NAME).default([]),
            })
            .default({ signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] }),
          subject: z
            .strictObject({
              pattern: z
                .string()
                .min(1)
                .superRefine((value, context) => {
                  const error = SubjectShape.patternError({ pattern: value });

                  if (error !== undefined) {
                    context.addIssue({ code: 'custom', message: error });
                  }
                }),
              hint: z.string().min(1).optional(),
            })
            .optional(),
        })
        .default({ agent: { signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] } }),
    })
    .default({
      message: { agent: { signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] } },
    }),
  events: z
    .strictObject({
      log: z.boolean().default(false),
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
      maxSize: z
        .string()
        .refine((value) => EventRetention.parseSize({ text: value }) !== undefined, {
          message: 'a size such as 50MB, 200MB or 1GB',
        })
        .optional(),
      maxFiles: z.number().int().min(1).optional(),
      maxAgeDays: z.number().int().min(1).optional(),
    })
    .default({ log: false }),
  local: z
    .strictObject({
      autoClean: z.boolean().default(true),
      tmp: LAYOUT_FOLDER.optional(),
    })
    .default({ autoClean: true }),
});
