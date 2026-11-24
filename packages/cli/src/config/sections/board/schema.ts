import { z } from 'zod';
import { BoardConstants, BoardServe, ProviderTypes } from '../../../board/common/constants.ts';
import { BoardLogo } from '../../../board/logo.ts';
import { BOARD_AGENTS } from '../../../board/schema.ts';

export const BOARD_SECTION = {
  /**
   * What `vulcan board` calls things. `owner` is who an ask waits on (default: `git config user.name`),
   * `title` the name on the page (default: the project name and "Board"), `logo` a path inside the project to an
   * SVG put on the page (default: none), `agents` an agent name to a face (`bun`, `flame`, `ember`, `rock`,
   * `banana`; any other agent has `bun`). Written to the manifest only when something is set.
   */
  board: z
    .strictObject({
      /** Who an ask waits on; default: `git config user.name`, else `Owner`. */
      owner: z.string().min(1).optional(),
      /** Name on the board page and tab; default: the project name and `Board`. */
      title: z.string().min(1).optional(),
      /** Name in the address of `vulcan board serve`: lowercase, ending in `.localhost`; default `vulz-board.venizia.ai.localhost`. */
      hostname: z
        .string()
        .regex(
          BoardServe.HOSTNAME,
          'a lowercase name that ends in .localhost, such as board.localhost',
        )
        .optional(),
      /** Path inside the project to an `.svg` file shown on the board page, with no leading `/` and no `..` segment; default none. */
      logo: z
        .string()
        .min(1)
        .refine((value) => BoardLogo.isPath({ path: value }), {
          message: 'a path inside the project to an .svg file, with no leading / and no .. segment',
        })
        .optional(),
      /** Faces and roles of the board's agents, keyed by agent name; default `{}`. */
      agents: BOARD_AGENTS.default({}),
    })
    .default({ agents: {} }),
  /**
   * The code host `vulcan board` reads pull requests, checks and commits from: `github` through `gh` (the default),
   * or `gitlab` through `glab`. `host` names the GitLab server (default `gitlab.com`): a bare host name with an
   * optional port, never a URL. Written to the manifest only when it is not `github`.
   */
  provider: z
    .strictObject({
      /** `github` or `gitlab`; default `github`. */
      type: z.enum([ProviderTypes.GITHUB, ProviderTypes.GITLAB]).default(ProviderTypes.GITHUB),
      /** The GitLab host name, such as `gitlab.example.com` or `gitlab.example.com:8443`; only with `gitlab`; default `gitlab.com`. */
      host: z
        .string()
        .regex(
          BoardConstants.GITLAB_HOST,
          'a bare host name such as gitlab.example.com, with an optional :port, no scheme, path or credentials',
        )
        .optional(),
    })
    .refine((provider) => provider.host === undefined || provider.type === ProviderTypes.GITLAB, {
      message: 'host is only for type "gitlab"',
      path: ['host'],
    })
    .default({ type: ProviderTypes.GITHUB }),
};
