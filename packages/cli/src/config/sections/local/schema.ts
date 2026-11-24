import { z } from 'zod';
import { LAYOUT_FOLDER } from '../../common/schema.ts';

export const LOCAL_SECTION = {
  /**
   * What `vulcan` keeps tidy in `.agents/local/` by itself. `autoClean` (default true) lets the session-start hook, at
   * most once a day, remove the safe part: stale `tmp/`, browser leftovers older than an hour, event files past their
   * limits, and release candidates whose version is tagged. It never removes a worktree or a clone.
   */
  local: z
    .strictObject({
      /** `true` lets the session-start hook clean the safe part of `.agents/local/` at most once a day; default `true`. */
      autoClean: z.boolean().default(true),
      /**
       * A folder of the project, from its root, for the temporary files of a session (default `.agents/tmp`). A
       * browser puts a socket below it and fails past 107 characters of path, so a deep checkout can name a short one (`t`).
       * Written like a layout folder: 1 to 4 plain lower-case segments, never absolute, never climbing. `vulcan sync`
       * creates it and gitignores it.
       */
      tmp: LAYOUT_FOLDER.optional(),
    })
    .default({ autoClean: true }),
};
