import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { LayoutConstants } from '../../../layout/common/constants.ts';
import { PrivateValueKinds } from '../../../doctor/common/constants.ts';
import type { TPrivateValueKind } from '../../../doctor/common/types.ts';

const KIND = z.custom<TPrivateValueKind>(
  (value) => typeof value === 'string' && PrivateValueKinds.isValid(value),
  { message: `one of ${PrivateValueKinds.values().join(', ')}` },
);

/** A decision to keep private values in files: where, which kinds (all when absent), and why. */
const ACKNOWLEDGEMENT = z.strictObject({
  /** Glob relative to the repo root, with no `..`, of the files that may keep private values. */
  path: z
    .string()
    .min(1)
    .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), {
      message: 'a glob relative to the repo root, without ..',
    }),
  /** Kinds of private value the decision covers: `private-key`, `token`, `url-credentials`, `ipv4` or `machine-path`; at least one, all kinds when absent. */
  types: z.array(KIND).min(1).optional(),
  /** Why the private values may stay in these files; trimmed, at least one character. */
  reason: z.string().trim().min(1),
  /** A standing decision, such as the ones VULCAN ships: not reported when it matches no file, and it alone does not start the acknowledged-files note. */
  standing: z.boolean().optional(),
});

/** What the layout check reads as a finding; every field has a default. */
const LAYOUT = z.strictObject({
  /** A source file with more lines than this is a `long-file` finding, a test file excepted; default 600. */
  maxLines: z.number().int().positive().default(LayoutConstants.DEFAULT_MAX_LINES),
  /** A folder with at least this many subfolders may keep no loose source file but `index.ts` or `index.tsx`; default 3. */
  minSubfolders: z.number().int().positive().default(LayoutConstants.DEFAULT_MIN_SUBFOLDERS),
  /** Role words that end in s and are not plurals, added to the shipped list (`class`, `status`, `alias`...); default none. */
  pluralAllow: z.array(z.string().min(1)).default([]),
  /** Globs relative to the repo root of generated files, which `long-file` skips; a file whose header says generated or do not edit is skipped too; default none. */
  generated: z.array(z.string().min(1)).default([]),
});

export const DOCTOR_SCHEMA = z.strictObject({
  /** Private values doctor tolerates: `acknowledged` lists files that may keep them, each with a reason; default none. */
  privateValues: z
    .strictObject({ acknowledged: z.array(ACKNOWLEDGEMENT).default([]) })
    .default({ acknowledged: [] }),
  /** The layout check (`vulcan check layout`, the doctor's `file-layout` warning): the line limit, the subfolder count, the role words that are not plurals and the generated files. */
  layout: LAYOUT.prefault({}),
});

export const DOCTOR_SECTION = {
  /** What `vulcan project doctor` is told: `privateValues.acknowledged` lists the files that may keep private values, each with a `reason`; `layout` sets the layout check. */
  doctor: DOCTOR_SCHEMA.prefault({}),
};
