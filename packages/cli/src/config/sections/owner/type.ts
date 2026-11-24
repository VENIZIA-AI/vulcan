import type { z } from 'zod';
import type { OWNER_SCHEMA } from './schema.ts';

/** The owner section as the CLI reads it: every default filled in. */
export type TOwnerConfig = z.output<typeof OWNER_SCHEMA>;
