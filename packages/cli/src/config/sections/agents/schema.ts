import { z } from 'zod';
import { LoaderEnvironment } from '../../../hooks/loader-environment.ts';
import { CodingAgents } from '../../common/index.ts';

const CODING_AGENT = z.string().refine((value) => CodingAgents.isValid(value), {
  message: `one of: ${[...CodingAgents.SCHEME_SET].join(', ')}`,
});

export const AGENTS_SECTION = {
  /** The project's suggested agents; each developer's own choice lives in `.agents/local/profile.json`. */
  agents: z.array(CODING_AGENT).optional(),
};

export const CLAUDE_SECTION = {
  /** Team-shared Claude settings (permissions, env, enabledPlugins...), merged by sync over personal keys. */
  claude: z
    .strictObject({
      /** The Claude settings merged into `.claude/settings.json`; an `env` that sets a `VULCAN_GUARD*` variable, `BUN_OPTIONS`, `NODE_OPTIONS` or a `BUN_CONFIG_*` variable is refused. */
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
};
