import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { IToolHandler } from '@/protocol/common';
import type { IReleaseIndex } from '@/releases';
import { z } from 'zod';
import {
  EXACT_VERSION_PATTERN,
  InstalledVersions,
  ToolInput,
  ToolTriggers,
  VersionInputSchema,
} from './common';

const DESCRIPTION =
  'Compare the @venizia/* packages installed in a directory against the newest versions this ' +
  'build knows about - the versions its generated release table carries, not the registry.';

// Built once at module load - a guarded tool that re-resolves its store on every call never needs
// to rebuild this.
const INPUT_JSON_SCHEMA = z.toJSONSchema(VersionInputSchema);

interface IBehindRow {
  package: string;
  installed: string;
  newest: string;
}

interface IVersionResponse {
  installed: Record<string, string | null>;
  snapshot: Record<string, string>;
  behind: IBehindRow[];
}

/** The newest version the release table knows for every package in it. */
const snapshotOf = (opts: { releases: IReleaseIndex; live: string[] }): Record<string, string> => {
  const snapshot: Record<string, string> = {};

  const names = opts.releases.packages().filter((candidate) => opts.live.includes(candidate));

  for (const name of names) {
    const newest = opts.releases.newestOf({ package: name });

    if (newest) {
      snapshot[name] = newest.version;
    }
  }

  return snapshot;
};

/**
 * One row per package whose installed version orders below the newest known one. An installed
 * version that never resolved, or a version neither side can parse, is skipped - never guessed.
 */
const behindOf = (opts: {
  releases: IReleaseIndex;
  installed: Record<string, string | null>;
  snapshot: Record<string, string>;
}): IBehindRow[] => {
  const rows: IBehindRow[] = [];

  const installedEntries = Object.entries(opts.installed);

  for (const [name, version] of installedEntries) {
    const packageName = opts.releases.packageOf({ package: name });
    const newest = opts.snapshot[packageName];

    if (version === null || newest === undefined) {
      continue;
    }

    if (!EXACT_VERSION_PATTERN.test(version) || !EXACT_VERSION_PATTERN.test(newest)) {
      continue;
    }

    if (Bun.semver.order(version, newest) < 0) {
      rows.push({ package: packageName, installed: version, newest });
    }
  }

  return rows;
};

export class VersionTool {
  static build(opts: { releases: IReleaseIndex; projects?: string }): IToolHandler {
    return {
      definition: {
        name: 'version',
        description: `${ToolTriggers.version({ projects: opts.projects })} ${DESCRIPTION}`,
        inputSchema: INPUT_JSON_SCHEMA,
      },
      call: async ({ args }) => {
        const input = ToolInput.parse({ schema: VersionInputSchema, args });

        // Dated entries without a release (no git history) still give no version to compare.
        if (opts.releases.packages().length === 0) {
          throw new RpcError({
            code: RpcErrorCodes.INVALID_PARAMS,
            message: opts.releases.emptyReason,
          });
        }

        const cwd = input.cwd ?? process.cwd();
        const installed = InstalledVersions.read({ cwd });

        const snapshot = snapshotOf({
          releases: opts.releases,
          live: opts.releases.livePackages(),
        });
        const response: IVersionResponse = {
          installed,
          snapshot,
          behind: behindOf({ releases: opts.releases, installed, snapshot }),
        };

        return response;
      },
    };
  }
}
