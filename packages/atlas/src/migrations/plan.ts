import { InstalledVersions, ToolErrors } from '@/tools/common';
import type { IChangelogRecord, IReleaseIndex } from '@/releases';
import { AppScan } from './scan';
import type { IMigrationTouch } from './scan';
import { BreakingBadge } from './badges';
import type { TMigrationDirection, TMigrationItem } from './schema';

export class MigrateDirections {
  static readonly UPGRADE = 'upgrade';
  static readonly DOWNGRADE = 'downgrade';
  /** The two versions are the same: nothing to do. */
  static readonly NONE = 'none';
}

export class MigrateTargets {
  /** `to` was `latest` or `next`: read from the release table, never from a registry. */
  static readonly RELEASE_TABLE = 'release table';
  static readonly VERSION = 'version';
}

/** One migration item of the window, in the direction the plan runs. */
export interface IMigrationStep {
  id: string;
  /** The changelog entry the item is from: `get` reads it in full. */
  entry: string;
  title: string;
  date: string;
  symbols: string[];
  /** The item's `upgrade` for an upgrade, its `downgrade` for a downgrade. */
  change: TMigrationDirection;
  data?: string;
  codemod?: string;
  /** Where the app's code reaches the item's symbols; empty when it does not. */
  touches: IMigrationTouch[];
}

/** A breaking entry of the window with no structured block: read it with `get`. */
export interface IUnstructuredEntry {
  id: string;
  title: string;
  date: string;
}

export interface IMigrationPlan {
  package: string;
  from: string;
  to: string;
  direction: string;
  /** Where `to` came from: the release table (`latest`, `next`) or the version as given. */
  target: string;
  steps: IMigrationStep[];
  unstructured: IUnstructuredEntry[];
}

export interface IMigrationResult {
  app: string;
  plans: IMigrationPlan[];
}

const LATEST = 'latest';
const NEXT = 'next';

const isStable = (opts: { version: string }): boolean => !opts.version.includes('-');

export class MigratePlan {
  /**
   * The plans an app needs to move `package` from `from` to `to` (a version, `latest` or `next`):
   * the window's migration items in the order they apply, each with where the app's code touches it.
   * Without `package`, one plan per installed package the sources know, and `to` must be `latest` or
   * `next`. `from` is the installed version when absent.
   */
  static plans(opts: {
    releases: IReleaseIndex;
    app: string;
    package?: string;
    from?: string;
    to: string;
  }): IMigrationResult {
    if (opts.releases.isEmpty()) {
      throw ToolErrors.invalidParams(opts.releases.emptyReason);
    }

    const installed = InstalledVersions.read({ cwd: opts.app });

    if (opts.package !== undefined) {
      const name = opts.releases.packageOf({ package: opts.package });
      const from =
        opts.from ??
        MigratePlan.installedOf({ installed, name, releases: opts.releases, app: opts.app });

      return { app: opts.app, plans: [MigratePlan.build({ ...opts, package: name, from })] };
    }

    if (opts.from !== undefined || (opts.to !== LATEST && opts.to !== NEXT)) {
      throw ToolErrors.invalidParams(
        'a version names one package: pass package with from, or with a version for to (latest and next need no package)',
      );
    }

    const served = Object.entries(installed).flatMap(([name, version]) =>
      version !== null && opts.releases.versionsOf({ package: name }).length > 0
        ? [{ name: opts.releases.packageOf({ package: name }), version }]
        : [],
    );

    if (served.length === 0) {
      throw ToolErrors.invalidParams(
        `no installed @venizia/* package of the sources atlas serves was found in ${opts.app}; pass package and from`,
      );
    }

    return {
      app: opts.app,
      plans: served.map(({ name, version }) =>
        MigratePlan.build({
          releases: opts.releases,
          app: opts.app,
          package: name,
          from: version,
          to: opts.to,
        }),
      ),
    };
  }

  private static installedOf(opts: {
    installed: Record<string, string | null>;
    name: string;
    releases: IReleaseIndex;
    app: string;
  }): string {
    const version = Object.entries(opts.installed).find(
      ([name]) => opts.releases.packageOf({ package: name }) === opts.name,
    )?.[1];

    if (version === undefined || version === null) {
      throw ToolErrors.invalidParams(
        `${opts.name} is not installed in ${opts.app} (no resolvable version in its package.json); pass from`,
      );
    }

    return version;
  }

  private static build(opts: {
    releases: IReleaseIndex;
    app: string;
    package: string;
    from: string;
    to: string;
  }): IMigrationPlan {
    const { releases } = opts;
    const versions = releases.versionsOf({ package: opts.package });

    if (versions.length === 0) {
      throw ToolErrors.unknownPackage({ name: opts.package, known: releases.declaredPackages() });
    }

    const isAlias = opts.to === LATEST || opts.to === NEXT;
    const to = MigratePlan.resolveTarget({ versions, to: opts.to, package: opts.package });

    for (const version of [opts.from, to]) {
      if (!versions.includes(version)) {
        throw ToolErrors.unknownVersion({ package: opts.package, version, known: versions });
      }
    }

    const target = isAlias ? MigrateTargets.RELEASE_TABLE : MigrateTargets.VERSION;
    const base = {
      package: opts.package,
      from: opts.from,
      to,
      target,
      steps: [],
      unstructured: [],
    };
    const sign = MigratePlan.compare({ releases, package: opts.package, from: opts.from, to });

    if (sign === 0) {
      return { ...base, direction: MigrateDirections.NONE };
    }

    const isUpgrade = sign > 0;
    const [older, newer] = isUpgrade ? [opts.from, to] : [to, opts.from];
    const window = MigratePlan.window({ releases, package: opts.package, older, newer });
    const ordered = isUpgrade ? [...window].reverse() : window;
    const withBlock = ordered.filter((entry) => entry.migration !== undefined);
    const targets = withBlock.flatMap((entry) =>
      (entry.migration ?? []).map((migration) => ({
        id: MigratePlan.keyOf({ entry, migration }),
        packages: [...new Set([opts.package, ...entry.packages])],
        symbols: migration.symbols,
      })),
    );
    const touches = AppScan.scan({ app: opts.app, targets });
    const steps = withBlock.flatMap((entry) => {
      const items = isUpgrade ? (entry.migration ?? []) : [...(entry.migration ?? [])].reverse();

      return items.map((migration): IMigrationStep => {
        const step: IMigrationStep = {
          id: migration.id,
          entry: entry.id,
          title: entry.title,
          date: entry.date,
          symbols: migration.symbols,
          change: isUpgrade ? migration.upgrade : migration.downgrade,
          touches: touches[MigratePlan.keyOf({ entry, migration })] ?? [],
        };

        if (migration.data !== undefined) {
          step.data = migration.data;
        }

        if (migration.codemod !== undefined) {
          step.codemod = migration.codemod;
        }

        return step;
      });
    });

    return {
      ...base,
      direction: isUpgrade ? MigrateDirections.UPGRADE : MigrateDirections.DOWNGRADE,
      steps,
      unstructured: ordered
        .filter(
          (entry) =>
            entry.migration === undefined &&
            entry.kind !== null &&
            BreakingBadge.canonical({ text: entry.kind }) === BreakingBadge.CANONICAL,
        )
        .map((entry) => ({ id: entry.id, title: entry.title, date: entry.date })),
    };
  }

  private static keyOf(opts: { entry: IChangelogRecord; migration: TMigrationItem }): string {
    return `${opts.entry.id}#${opts.migration.id}`;
  }

  private static resolveTarget(opts: { versions: string[]; to: string; package: string }): string {
    if (opts.to === NEXT) {
      return opts.versions[0];
    }

    if (opts.to === LATEST) {
      const stable = opts.versions.find((version) => isStable({ version }));

      if (stable === undefined) {
        throw ToolErrors.invalidParams(
          `${opts.package} has no stable release in the release table; use next or a version`,
        );
      }

      return stable;
    }

    return opts.to;
  }

  /** Positive when `to` is newer than `from`, negative when older, 0 when the same: by commit order, else by semver. */
  private static compare(opts: {
    releases: IReleaseIndex;
    package: string;
    from: string;
    to: string;
  }): number {
    if (opts.from === opts.to) {
      return 0;
    }

    const fromOrder = opts.releases.releaseOrderOf({ package: opts.package, version: opts.from });
    const toOrder = opts.releases.releaseOrderOf({ package: opts.package, version: opts.to });

    return fromOrder !== undefined && toOrder !== undefined
      ? toOrder - fromOrder
      : Bun.semver.order(opts.to, opts.from);
  }

  /** The entries of `package` in (older, newer], newest first, by commit order when the table has it. */
  private static window(opts: {
    releases: IReleaseIndex;
    package: string;
    older: string;
    newer: string;
  }): IChangelogRecord[] {
    const { releases } = opts;
    const at = (version: string) => ({
      order: releases.releaseOrderOf({ package: opts.package, version }),
      date: releases.releaseDateOf({ package: opts.package, version }) ?? '',
    });
    const lower = at(opts.older);
    const upper = at(opts.newer);

    return lower.order !== undefined && upper.order !== undefined
      ? releases.entriesBetweenOrders({
          package: opts.package,
          fromOrder: lower.order,
          toOrder: upper.order,
          fromDate: lower.date,
          toDate: upper.date,
        })
      : releases.entriesBetween({
          package: opts.package,
          fromDate: lower.date,
          toDate: upper.date,
        });
  }
}
