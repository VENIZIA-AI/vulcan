import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { PrivateValueKinds } from './common/constants.ts';
import type { TPrivateValueKind } from './common/types.ts';

const KIND = z.custom<TPrivateValueKind>(
  (value) => typeof value === 'string' && PrivateValueKinds.isValid(value),
  { message: `one of ${[...PrivateValueKinds.SCHEME_SET].join(', ')}` },
);

/** A decision to keep private values in files: where, which kinds (all when absent), and why. */
const ACKNOWLEDGEMENT = z.strictObject({
  path: z
    .string()
    .min(1)
    .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), {
      message: 'a glob relative to the repo root, without ..',
    }),
  /** Kinds of private value the decision covers: `private-key`, `token`, `url-credentials`, `ipv4` or `machine-path`; at least one, all kinds when absent. */
  kinds: z.array(KIND).min(1).optional(),
  /** Why the private values may stay in these files; trimmed, at least one character. */
  reason: z.string().trim().min(1),
});

export const DOCTOR_SCHEMA = z.strictObject({
  privateValues: z
    .strictObject({ acknowledged: z.array(ACKNOWLEDGEMENT).default([]) })
    .default({ acknowledged: [] }),
});

export type TPrivateValueAcknowledgement = z.output<typeof ACKNOWLEDGEMENT>;
