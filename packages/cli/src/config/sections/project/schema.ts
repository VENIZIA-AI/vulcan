import { z } from 'zod';
import { ProjectKey } from '../../../events/project-key.ts';

export const PROJECT_SECTION = {
  /** The project's name in the manifest and in every atlas result; default: the root package name, unscoped. */
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  /** The project's flow key: a flow is named `VULZ-<key>-<number>`, and VULCAN gives the number. Set once, when the project starts. */
  project: z
    .strictObject({ key: z.string().regex(ProjectKey.PATTERN, ProjectKey.MESSAGE) })
    .optional(),
};
