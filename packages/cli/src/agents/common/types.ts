import type { z } from 'zod';
import type { AGENT_ENTRY_SCHEMA } from './schema.ts';

export type TAgentEntry = z.infer<typeof AGENT_ENTRY_SCHEMA>;

/** What the question shows: what was detected on this machine, and what the developer chose before. */
export interface IAgentQuestion {
  detected: string[];
  stored: string[] | undefined;
}

export type TAskAgents = (question: IAgentQuestion) => string | null;

export type TAgentSource = 'flag' | 'local' | 'config' | 'migration' | 'asked' | 'default';

export type TAgentResolution =
  | {
      ok: true;
      agents: string[];
      source: TAgentSource;
      /** Whether sync stores the list in the local file. */
      writeLocal: boolean;
      /** One line for stderr when the machine has not chosen. */
      hint: string | undefined;
    }
  | { ok: false; error: string };

export type TLocalChoice =
  | { ok: true; agents: string[] | undefined }
  | { ok: false; error: string };
