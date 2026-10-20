import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { BASE_DIRECTORY } from '../common/index.ts';
import { AGENT_ENTRY_SCHEMA } from './common/index.ts';
import type { TAgentEntry } from './common/index.ts';

const TABLE_SCHEMA = z.array(AGENT_ENTRY_SCHEMA).superRefine((entries, context) => {
  const seen = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.id)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `'${entry.id}' is used twice`,
      });
    }

    seen.add(entry.id);
  }
});

let cached: TAgentEntry[] | undefined;

/** The shipped table, in the order the questions and the list show it; a broken table throws. */
export const readAgentTable = (): TAgentEntry[] => {
  cached ??= TABLE_SCHEMA.parse(
    JSON.parse(readFileSync(join(BASE_DIRECTORY, 'agents.json'), 'utf8')),
  );

  return cached;
};

export const agentIds = (): string[] => readAgentTable().map(entry => entry.id);
