import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { PrivateValueKinds } from './common/constants.ts';

const KIND = z.enum([
  PrivateValueKinds.PRIVATE_KEY,
  PrivateValueKinds.TOKEN,
  PrivateValueKinds.URL_CREDENTIALS,
  PrivateValueKinds.IPV4,
  PrivateValueKinds.MACHINE_PATH,
]);

/** A decision to keep private values in files: where, which kinds (all when absent), and why. */
const ACKNOWLEDGEMENT = z.strictObject({
  path: z
    .string()
    .min(1)
    .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), {
      message: 'a glob relative to the repo root, without ..',
    }),
  kinds: z.array(KIND).min(1).optional(),
  reason: z.string().trim().min(1),
});

export const DOCTOR_SCHEMA = z.strictObject({
  privateValues: z
    .strictObject({ acknowledged: z.array(ACKNOWLEDGEMENT).default([]) })
    .default({ acknowledged: [] }),
});

export type TPrivateValueAcknowledgement = z.output<typeof ACKNOWLEDGEMENT>;
