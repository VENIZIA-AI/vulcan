import { z } from 'zod';
import { SiteUrl } from '@venizia/vulcan-atlas';
import { ConfigConstants } from '../../common/index.ts';

export const KNOWLEDGE_SECTION = {
  /** Where the project keeps its knowledge bundle, wiki, changelogs and sync map; read by okf and doctor. */
  knowledge: z
    .strictObject({
      /** Folder of the knowledge bundle (the OKF concepts); default `.agents/knowledge`. */
      bundle: z.string().default(ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE),
      /** Folder of the wiki content; absent means the project has none. */
      wiki: z.string().optional(),
      /** Folder of the changelog files; absent means the project has none. */
      changelogs: z.string().optional(),
      /**
       * The cutover of the migration gate. `YYYY-MM-DD`: a dated entry on or after it owes a `migration` block when it is a
       * Breaking Change. `X.Y.Z`: version folders from that version on are the changelog and dated files are history.
       */
      migrationFrom: z
        .string()
        .regex(/^(?:\d{4}-\d{2}-\d{2}|\d+\.\d+\.\d+)$/)
        .optional(),
      /**
       * The command that runs the codemods of this project's migrations: a bare binary name found in the app's
       * `node_modules/.bin`, then fixed words (`['tool', 'codemod']`); default `['devz', 'codemod']`. A migration names
       * a codemod, never a command: the runner is the source project's, so a changelog cannot run anything.
       */
      codemodCommand: z
        .array(z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i))
        .min(1)
        .optional(),
      /** `YYYY-MM-DD`: the last date a dated changelog file may carry; a later one fails the changelog check. */
      datedUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      /**
       * The address of the project's wiki (`https://wiki.example.com`): `vulcan migrate plan` prints a link to the
       * upgrade guide of each step on it, `<siteUrl>/changelogs/<version>/upgrade#<id>`. An https address (http only on
       * localhost) with no credentials, query, fragment or control character, kept without its trailing slash; omit it
       * and the plan prints no link.
       */
      siteUrl: z
        .string()
        .transform((value, context) => {
          const parsed = SiteUrl.parse({ value });

          if ('problem' in parsed) {
            context.addIssue({ code: 'custom', message: parsed.problem });

            return z.NEVER;
          }

          return parsed.href;
        })
        .optional(),
      /** A map of code areas to concepts; no shipped skill reads it. */
    })
    .default({ bundle: ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE }),
};
