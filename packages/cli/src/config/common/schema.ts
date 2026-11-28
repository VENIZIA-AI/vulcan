import { z } from 'zod';
import { LayoutFolder } from '../../common/layout-folder.ts';

/** A key that was removed: optional, and refused when present with the key and what to do, instead of a bare "unrecognized key". */
export const REMOVED_OKF_KEY = (opts: { fix: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({ code: 'custom', message: `removed: ${opts.fix}` });
    })
    .optional();

/** A layout folder: 1 to 4 plain segments, never climbing, never absolute. */
export const LayoutFolderSchema = z.string().superRefine((value, context) => {
  const problem = LayoutFolder.layoutFolderProblem({ folder: value });

  if (problem !== undefined) {
    context.addIssue({ code: 'custom', message: problem });
  }
});
