import { z } from 'zod';
import { CodingAgents, ConfigConstants, HookEvents } from './common/index.ts';

const CODING_AGENT = z.string().refine(value => CodingAgents.isValid(value), {
  message: `one of: ${[...CodingAgents.SCHEME_SET].join(', ')}`,
});
const HOOK_EVENT = z.string().refine(value => HookEvents.isValid(value), {
  message: `one of: ${[...HookEvents.SCHEME_SET].join(', ')}`,
});

/** `.configs/vulcan.config.*` - strict: an unknown key is a typo, and a typo is an error. */
export const VULCAN_CONFIG_SCHEMA = z.strictObject({
  agents: z.array(CODING_AGENT).default([CodingAgents.CLAUDE]),
  rules: z.record(z.string().regex(ConfigConstants.RULE_ID_PATTERN), z.string()).default({}),
  knowledge: z
    .strictObject({
      bundle: z.string().default(ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE),
      wiki: z.string().optional(),
      changelogs: z.string().optional(),
    })
    .default({ bundle: ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE }),
  /** Validated now; consumed once okf reads project config (plan: known gaps). */
  okf: z
    .strictObject({
      renderers: z.array(z.string()).optional(),
      coverage: z.array(z.strictObject({ name: z.string(), path: z.string() })).optional(),
    })
    .optional(),
  /** `packages` is read by atlas surface/symbols (required there); the rest is validated, read later. */
  atlas: z
    .strictObject({
      packages: z.record(z.string(), z.string()).optional(),
      tagPattern: z.string().optional(),
      legacyTagPrefixes: z.array(z.string()).optional(),
      releaseCommit: z.string().optional(),
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
});

export type VulcanConfig = z.input<typeof VULCAN_CONFIG_SCHEMA>;
export type TResolvedConfig = z.output<typeof VULCAN_CONFIG_SCHEMA>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfig): VulcanConfig => config;
