import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { BASE_DIRECTORY } from '../common/index.ts';
import type { ICommitAgents } from './common/index.ts';

const AGENTS_SCHEMA = z.strictObject({
  products: z.array(z.string().min(1)).min(1),
  mentions: z.array(z.string().min(1)).min(1),
  addressNames: z.array(z.string().min(1)),
  addressDomains: z.array(z.string().min(1)),
  noreplyDomains: z.array(z.string().min(1)),
  generatedPhrases: z.array(z.string().min(1)).min(1),
});

let cached: z.output<typeof AGENTS_SCHEMA> | undefined;

export class CommitAgents {
  /** `extra` joins both `products` and `mentions`. A broken table throws. */
  static read(opts: { extra: string[]; allow?: string[] }): ICommitAgents {
    cached ??= AGENTS_SCHEMA.parse(
      JSON.parse(readFileSync(join(BASE_DIRECTORY, 'commit-agents.json'), 'utf8')),
    );

    return {
      ...cached,
      products: [...new Set([...cached.products, ...opts.extra])],
      mentions: [...new Set([...cached.mentions, ...opts.extra])],
      allow: opts.allow ?? [],
    };
  }
}
