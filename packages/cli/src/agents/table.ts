import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { BASE_DIRECTORY } from '../common/index.ts';
import { AgentEntrySchema } from './common/index.ts';
import type { TAgentEntry } from './common/index.ts';

const TableSchema = z.array(AgentEntrySchema).superRefine((entries, context) => {
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

export class AgentTable {
  /** The shipped table, in the order the questions and the list show it; a broken table throws. */
  static read(): TAgentEntry[] {
    cached ??= TableSchema.parse(
      JSON.parse(readFileSync(join(BASE_DIRECTORY, 'agents.json'), 'utf8')),
    );

    return cached;
  }

  static agentIds(): string[] {
    return AgentTable.read().map((entry) => entry.id);
  }
}
