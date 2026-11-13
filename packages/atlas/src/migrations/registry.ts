import { AtlasTimeouts } from '@/common/constants';
import type { IReleaseIndex } from '@/releases';
import { ToolErrors } from '@/tools/common';
import type { IMigrationPlan, IMigrationResult } from './plan';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const ABBREVIATED = 'application/vnd.npm.install-v1+json';

/** What npm publishes for a package: its dist-tags and every version. */
export interface IPublished {
  tags: Record<string, string>;
  versions: string[];
}

/** Reads what npm publishes for a package; `undefined` when it cannot be asked, so no claim is made. */
export type TPublishedLookup = (opts: { name: string }) => Promise<IPublished | undefined>;

const recordOf = (opts: { value: unknown }): Record<string, unknown> =>
  typeof opts.value === 'object' && opts.value !== null
    ? Object.fromEntries(Object.entries(opts.value))
    : {};

/**
 * The registry check of `migrate`: the atlas answers from the ref of its source, and npm may be ahead of it.
 * One request per package, bounded; any failure (offline, a private package, a bad answer) is "no claim".
 */
export class MigrateRegistry {
  static readonly LATEST = 'latest';
  static readonly NEXT = 'next';

  static async published(opts: { name: string }): Promise<IPublished | undefined> {
    const registry = (process.env.VULCAN_NPM_REGISTRY ?? DEFAULT_REGISTRY).replace(/\/+$/, '');

    try {
      const response = await fetch(`${registry}/${opts.name.replace('/', '%2f')}`, {
        headers: { accept: ABBREVIATED },
        signal: AbortSignal.timeout(AtlasTimeouts.REF_LOOKUP_MS),
      });

      if (!response.ok) {
        return undefined;
      }

      const json: unknown = await response.json();
      const body = recordOf({ value: json });
      const tags = Object.fromEntries(
        Object.entries(recordOf({ value: body['dist-tags'] })).flatMap(([tag, version]) =>
          typeof version === 'string' ? [[tag, version]] : [],
        ),
      );

      return { tags, versions: Object.keys(recordOf({ value: body.versions })) };
    } catch {
      return undefined;
    }
  }

  /**
   * An explicit `to` that the atlas does not know but npm publishes: the atlas ref is behind, and the plain
   * "unknown version" would send the reader to the wrong place. Throws that error; otherwise returns.
   */
  static async refuseBehindVersion(opts: {
    releases: IReleaseIndex;
    package?: string;
    to: string;
    lookup: TPublishedLookup;
  }): Promise<void> {
    if (
      opts.package === undefined ||
      opts.to === MigrateRegistry.LATEST ||
      opts.to === MigrateRegistry.NEXT
    ) {
      return;
    }

    const name = opts.releases.packageOf({ package: opts.package });
    const known = opts.releases.versionsOf({ package: name });

    if (known.length === 0 || known.includes(opts.to)) {
      return;
    }

    const published = await opts.lookup({ name });

    if (published?.versions.includes(opts.to) === true) {
      throw ToolErrors.invalidParams(
        `${name}@${opts.to} is published to npm but the atlas does not know it: the atlas source's ref is behind the registry; move the ref (atlas.sources) and run \`vulcan x atlas pull\`. The newest the atlas knows is ${known[0]}`,
      );
    }
  }

  /** Marks each plan whose `latest` or `next` npm resolves to a version the atlas has not got. */
  static async markBehind(opts: {
    releases: IReleaseIndex;
    result: IMigrationResult;
    to: string;
    lookup: TPublishedLookup;
  }): Promise<void> {
    if (opts.to !== MigrateRegistry.LATEST && opts.to !== MigrateRegistry.NEXT) {
      return;
    }

    await Promise.all(
      opts.result.plans.map(async (plan: IMigrationPlan) => {
        const published = await opts.lookup({ name: plan.package });
        const version = published?.tags[opts.to];

        if (
          version === undefined ||
          opts.releases.versionsOf({ package: plan.package }).includes(version)
        ) {
          return;
        }

        plan.behind = `the atlas source's ref is behind npm ${opts.to} ${version} (the atlas resolves ${opts.to} to ${plan.to}): this plan stops short of it. Move the ref (atlas.sources), run \`vulcan x atlas pull\` and plan again`;
      }),
    );
  }
}
