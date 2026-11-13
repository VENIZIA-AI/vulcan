import type { IToolHandler } from '@/protocol/common';
import type { IReleaseIndex } from '@/releases';
import { MigratePlan } from '@/migrations/plan';
import { MigrateRegistry } from '@/migrations/registry';
import type { TPublishedLookup } from '@/migrations/registry';
import { z } from 'zod';
import { MigrateInputSchema, ToolInput, ToolTriggers } from './common';

const DESCRIPTION =
  'Plan what an app must change to move a @venizia/* package from one version to another, newer or ' +
  "older, any number of releases apart: the window's migration steps in the order they apply, each " +
  "with the places in the app's code it touches (file:line), its codemod and data warnings, plus the " +
  'breaking entries that carry no structured steps. `from` defaults to the installed version, `to` is a ' +
  'version, `latest` or `next` (read from the release table). Read only: it never edits the app.';

// Built once at module load, like the other tools.
const INPUT_JSON_SCHEMA = z.toJSONSchema(MigrateInputSchema);

export class MigrateTool {
  /** `published` asks npm what a package has published; tests pass their own, and `undefined` from it means no claim. */
  static build(opts: {
    releases: IReleaseIndex;
    projects?: string;
    published?: TPublishedLookup;
  }): IToolHandler {
    const lookup = opts.published ?? MigrateRegistry.published;

    return {
      definition: {
        name: 'migrate',
        description: `${ToolTriggers.migrate({ projects: opts.projects })} ${DESCRIPTION}`,
        inputSchema: INPUT_JSON_SCHEMA,
      },
      call: async ({ args }) => {
        const input = ToolInput.parse({ schema: MigrateInputSchema, args });

        await MigrateRegistry.refuseBehindVersion({
          releases: opts.releases,
          package: input.package,
          to: input.to,
          lookup,
        });

        const result = MigratePlan.plans({
          releases: opts.releases,
          app: input.app ?? process.cwd(),
          package: input.package,
          from: input.from,
          to: input.to,
        });

        await MigrateRegistry.markBehind({ releases: opts.releases, result, to: input.to, lookup });

        return result;
      },
    };
  }
}
