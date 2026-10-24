import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AgentConstants } from './common/index.ts';
import type { TLocalChoice } from './common/index.ts';
import { agentIds } from './table.ts';

export const LOCAL_AGENTS_FILE = AgentConstants.LOCAL_FILE;

const LOCAL_SCHEMA = z.object({
  schemaVersion: z.literal(AgentConstants.LOCAL_SCHEMA_VERSION),
  agents: z.array(z.string()),
});

export const renderLocalChoice = (opts: { agents: string[] }): string =>
  `${JSON.stringify(
    {
      $generated: AgentConstants.LOCAL_NOTE,
      schemaVersion: AgentConstants.LOCAL_SCHEMA_VERSION,
      agents: opts.agents,
    },
    null,
    2,
  )}\n`;

/** The developer's stored choice: absent is "not chosen yet", a broken file is an error, never a silent default. */
export const readLocalChoice = (opts: { root: string }): TLocalChoice => {
  const file = join(opts.root, LOCAL_AGENTS_FILE);

  if (!existsSync(file)) {
    return { ok: true, agents: undefined };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {
      ok: false,
      error: `${LOCAL_AGENTS_FILE} is not valid JSON - delete it and run: vulcan sync --agents <list>`,
    };
  }

  const checked = LOCAL_SCHEMA.safeParse(parsed);

  if (!checked.success) {
    return {
      ok: false,
      error: `${LOCAL_AGENTS_FILE} is not what vulcan sync writes - delete it and run: vulcan sync --agents <list>`,
    };
  }

  const known = new Set(agentIds());
  const unknown = checked.data.agents.find((id) => !known.has(id));

  if (unknown !== undefined) {
    return {
      ok: false,
      error: `${LOCAL_AGENTS_FILE} names unknown agent '${unknown}' - one of: ${[...known].join(', ')}`,
    };
  }

  return { ok: true, agents: checked.data.agents };
};
