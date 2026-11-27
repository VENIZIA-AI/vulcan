import { existsSync, statSync } from 'node:fs';
import { RpcError } from '@/protocol/common';
import { InstalledVersions, ToolErrors } from '@/tools/common';
import type { IChangelogRecord, IFolderHistory, IReleaseIndex } from '@/releases';
import { VersionFolders } from '@/changelogs/version-folder';
import { AppScan } from './scan';
import { CodemodRunner } from '@/common/codemod-runner';
import { BreakingBadge } from './badges';
import type { TMigrationItem } from './schema';
import { MigrateDirections } from './directions';
import type { TStepDirection } from './directions';
import { MigrateTargets } from './plan-result';
import type {
  IMigrationPlan,
  IMigrationResult,
  IMigrationStep,
  TMigrateTarget,
} from './plan-result';
import { FolderStates } from './states';
import type { IStateMove } from './states';

export * from './directions';
export * from './plan-result';

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

    if (!existsSync(opts.app) || !statSync(opts.app).isDirectory()) {
      throw ToolErrors.invalidParams(`app directory not found: ${opts.app}`);
    }

    const installed = InstalledVersions.read({ cwd: opts.app });

    if (opts.package !== undefined) {
      const name = opts.releases.packageOf({ package: opts.package });
      const from =
        opts.from ??
        MigratePlan.installedOf({ installed, name, releases: opts.releases, app: opts.app });

      return {
        app: opts.app,
        plans: [MigratePlan.build({ ...opts, package: name, from })],
        skipped: [],
        unserved: [],
      };
    }

    if (opts.from !== undefined || (opts.to !== LATEST && opts.to !== NEXT)) {
      throw ToolErrors.invalidParams(
        'a version names one package: pass package with from, or with a version for to (latest and next need no package)',
      );
    }

    const present = Object.entries(installed).flatMap(([name, version]) =>
      version === null ? [] : [{ name, version }],
    );
    const served = present.filter(
      ({ name }) => opts.releases.versionsOf({ package: name }).length > 0,
    );

    if (served.length === 0) {
      throw ToolErrors.invalidParams(
        `no installed @venizia/* package of the sources atlas serves was found in ${opts.app}; pass package and from`,
      );
    }

    const result: IMigrationResult = { app: opts.app, plans: [], skipped: [], unserved: [] };

    for (const { name } of present.filter((entry) => !served.includes(entry))) {
      result.unserved.push(name);
    }

    for (const { name, version } of served) {
      try {
        result.plans.push(
          MigratePlan.build({
            releases: opts.releases,
            app: opts.app,
            package: name,
            from: version,
            to: opts.to,
          }),
        );
      } catch (error) {
        // One package the table cannot place (a local build) does not stop the plans of the others.
        if (!(error instanceof RpcError)) {
          throw error;
        }

        result.skipped.push({ package: name, reason: error.message });
      }
    }

    return result;
  }

  /** Why a package has no release: no source declares it - one may have failed (the server's notice says which) or was never pulled. */
  private static notServedReason(opts: { name: string }): string {
    return `${opts.name} is not served by any atlas source: check knowledge.atlas.sources in the config and run \`vulcan atlas pull\`, or see which source failed`;
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
      throw ToolErrors.invalidParams(
        `${MigratePlan.notServedReason({ name: opts.package })}; known packages: ${releases.declaredPackages().slice(0, 10).join(', ')}`,
      );
    }

    const isAlias = opts.to === LATEST || opts.to === NEXT;
    const to = MigratePlan.resolveTarget({ versions, to: opts.to, package: opts.package });

    for (const version of [opts.from, to]) {
      if (!versions.includes(version)) {
        throw ToolErrors.unknownVersion({ package: opts.package, version, known: versions });
      }
    }

    const target: TMigrateTarget = isAlias ? MigrateTargets.RELEASE_TABLE : MigrateTargets.VERSION;
    const base = {
      package: opts.package,
      from: opts.from,
      to,
      target,
      entries: 0,
      steps: [],
      unstructured: [],
      unreadable: [],
    };
    const sign = MigratePlan.compare({ releases, package: opts.package, from: opts.from, to });

    if (sign === 0) {
      return { ...base, direction: MigrateDirections.NONE };
    }

    const isUpgrade = sign > 0;
    const [older, newer] = isUpgrade ? [opts.from, to] : [to, opts.from];
    const history = releases.folderHistoryOf({ package: opts.package });
    const hasFolders = history !== undefined && history.folders().length > 0;
    const read =
      history !== undefined && hasFolders
        ? MigratePlan.foldedRead({
            releases,
            history,
            package: opts.package,
            older,
            newer,
            versions,
            isUpgrade,
          })
        : {
            older: MigratePlan.window({ releases, package: opts.package, older, newer }),
            newer: [],
            moves: [],
            notes: [],
            considered: 0,
            degraded: false,
          };
    const window = [...read.newer, ...read.older];
    const orderedOf = (entries: IChangelogRecord[]): IChangelogRecord[] =>
      isUpgrade ? [...entries].reverse() : entries;
    const ordered = orderedOf(window);
    const direction = isUpgrade ? MigrateDirections.UPGRADE : MigrateDirections.DOWNGRADE;
    const withBlock = ordered.filter((entry) => entry.migration !== undefined);
    const stateKey = (move: IStateMove): string =>
      `${move.item.entry}#${move.item.id}#${move.direction}`;
    const moves = read.moves.filter((move) => move.item.block !== undefined);
    const targets = [
      ...withBlock.flatMap((entry) =>
        (entry.migration ?? []).map((migration) => ({
          id: MigratePlan.keyOf({ entry, migration }),
          packages: [...new Set([opts.package, ...entry.packages])],
          symbols: migration.symbols,
        })),
      ),
      ...moves.map((move) => ({
        id: stateKey(move),
        packages: [opts.package],
        symbols: move.item.block?.symbols ?? [],
      })),
    ];
    const scanned = AppScan.scan({ app: opts.app, targets });
    const { touches } = scanned;
    const legacyStepsOf = (entries: IChangelogRecord[]): IMigrationStep[] =>
      orderedOf(entries)
        .filter((entry) => entry.migration !== undefined)
        .flatMap((entry) => {
          const items = isUpgrade
            ? (entry.migration ?? [])
            : [...(entry.migration ?? [])].reverse();

          return items.map((migration): IMigrationStep => {
            const step: IMigrationStep = {
              id: migration.id,
              entry: entry.id,
              title: entry.title,
              date: entry.date,
              symbols: migration.symbols,
              direction,
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
    const siteUrl = releases.siteUrlOf({ package: opts.package });
    const stateStep = (move: IStateMove): IMigrationStep | undefined => {
      const { block } = move.item;

      if (block === undefined) {
        return undefined;
      }

      const step: IMigrationStep = {
        id: move.item.id,
        entry: move.item.entry,
        title: move.item.title,
        date: move.item.date,
        symbols: block.symbols,
        direction: move.direction,
        change: move.direction === MigrateDirections.UPGRADE ? block.upgrade : block.downgrade,
        touches: touches[stateKey(move)] ?? [],
      };

      if (move.changed) {
        step.changed = true;
      }

      if (block.data !== undefined) {
        step.data = block.data;
      }

      if (block.codemod !== undefined) {
        step.codemod = block.codemod;
      }

      if (siteUrl !== undefined) {
        step.guide = `${siteUrl}/changelogs/${move.item.line}/upgrade#${move.item.id}`;
      }

      return step;
    };
    const stateSteps = (which: TStepDirection): IMigrationStep[] =>
      read.moves
        .filter((move) => move.direction === which)
        .map((move) => stateStep(move))
        .filter((step): step is IMigrationStep => step !== undefined);
    // Everything an app undoes comes first, newest first; then everything it applies, oldest first. The dated entries
    // before the folders are the oldest part; the ones inside a folded line the plan ends in are the newest.
    const olderLegacy = legacyStepsOf(read.older);
    const newerLegacy = legacyStepsOf(read.newer);
    const steps = isUpgrade
      ? [
          ...stateSteps(MigrateDirections.DOWNGRADE),
          ...olderLegacy,
          ...stateSteps(MigrateDirections.UPGRADE),
          ...newerLegacy,
        ]
      : [
          ...newerLegacy,
          ...stateSteps(MigrateDirections.DOWNGRADE),
          ...olderLegacy,
          ...stateSteps(MigrateDirections.UPGRADE),
        ];
    // An item with no block that changes section is in two moves: it is listed once.
    const unstructuredStates = [
      ...new Map(
        read.moves
          .filter(
            (move) => move.item.block === undefined && FolderStates.isOwing({ item: move.item }),
          )
          .map((move) => [
            move.item.entry,
            { id: move.item.entry, title: move.item.title, date: move.item.date },
          ]),
      ).values(),
    ];

    const plan: IMigrationPlan = {
      ...base,
      direction: isUpgrade ? MigrateDirections.UPGRADE : MigrateDirections.DOWNGRADE,
      entries: window.length + read.considered,
      unreadable: scanned.unreadable,
      steps,
      unstructured: [
        ...ordered
          .filter(
            (entry) =>
              entry.migration === undefined &&
              // `breaking` sees every badge; a table written without it still has the first badge in `badge`.
              (entry.breaking === true ||
                (entry.badge !== null &&
                  BreakingBadge.canonical({ text: entry.badge }) === BreakingBadge.CANONICAL)),
          )
          .map((entry) => ({ id: entry.id, title: entry.title, date: entry.date })),
        ...unstructuredStates,
      ],
    };

    if (steps.some((step) => step.codemod !== undefined)) {
      plan.apply = `vulcan migrate apply --package ${opts.package} --from ${opts.from} --to ${to} --app ${opts.app}`;
      plan.codemodCommand = releases.codemodCommandOf({ package: opts.package }) ?? [
        ...CodemodRunner.DEFAULT,
      ];
      plan.codemodPackages = releases.codemodPackagesOf({ package: opts.package });
    }

    const notes = [...read.notes];
    const line = FolderStates.lineOf({ version: newer });
    const names = history === undefined ? [] : history.folders().map((folder) => folder.name);
    const newest = names.sort((a, b) => Bun.semver.order(b, a))[0];

    if (newest !== undefined && Bun.semver.order(line, newest) > 0) {
      notes.push(
        `the folders of this source end at ${newest} and hold none for ${line}: the steps of ${line} are not in this plan. Check the source's ref in .configs/vulcan.config.* (a branch such as develop), then run \`vulcan atlas pull\``,
      );
    }

    if (isAlias && !isUpgrade) {
      notes.push(
        `${opts.to} is ${to}, older than the installed ${opts.from}: this plan is a downgrade; use next to stay on the newest release`,
      );
    }

    if (notes.length > 0) {
      plan.note = notes.join('; ');
    }

    if (read.degraded) {
      plan.degraded = true;
    }

    return plan;
  }

  /**
   * The folder part of a window over a package that has version folders: the dated entries no folder covers, and the
   * moves between the states at the two ends. A prerelease of a line that was folded in after its release has no folder
   * at its tag, so the plan splits at that line's stable: the dated files inside the line are read as they are, and the
   * states count from (or up to) the stable.
   */
  private static foldedRead(opts: {
    releases: IReleaseIndex;
    history: IFolderHistory;
    package: string;
    older: string;
    newer: string;
    versions: string[];
    isUpgrade: boolean;
  }): {
    older: IChangelogRecord[];
    newer: IChangelogRecord[];
    moves: IStateMove[];
    notes: string[];
    considered: number;
    degraded: boolean;
  } {
    const { releases, history, versions } = opts;
    const stateOf = (version: string) =>
      FolderStates.stateOf({ history, package: opts.package, version, versions });
    const olderState = stateOf(opts.older);
    const newerState = stateOf(opts.newer);
    const notes = [...olderState.notes, ...newerState.notes];
    const degraded = olderState.degraded === true || newerState.degraded === true;
    const olderEntries: IChangelogRecord[] = [];
    const newerEntries: IChangelogRecord[] = [];
    let olderItems = olderState.items;
    const newerItems = newerState.items;
    let lower: string | undefined = opts.older;
    let upper: string | undefined = opts.newer;
    const windowOf = (bounds: { older?: string; newer?: string; includeFolded: boolean }) =>
      MigratePlan.window({
        releases,
        package: opts.package,
        older: bounds.older,
        newer: bounds.newer,
        datedOnly: true,
        includeFolded: bounds.includeFolded,
      });

    if (olderState.folded !== undefined && olderState.folded === newerState.folded) {
      notes.push(MigratePlan.foldedNote({ version: opts.older, line: olderState.folded }));

      return {
        older: windowOf({ older: opts.older, newer: opts.newer, includeFolded: true }),
        newer: [],
        moves: [],
        notes,
        considered: 0,
        degraded,
      };
    }

    if (newerState.folded !== undefined) {
      const before = versions.find(
        (version) =>
          VersionFolders.isName({ name: version }) &&
          Bun.semver.order(version, newerState.folded ?? '') < 0,
      );

      notes.push(MigratePlan.foldedNote({ version: opts.newer, line: newerState.folded }));
      newerEntries.push(...windowOf({ older: before, newer: opts.newer, includeFolded: true }));
      upper = before;
    }

    if (olderState.folded !== undefined) {
      const line = olderState.folded;
      // Folded after its release: its stable is out and the plan reaches it. Otherwise the folder came into the line
      // after this prerelease, so this version only predates it, and the folder at the other end counts as new.
      const isFolded = versions.includes(line) && Bun.semver.order(opts.newer, line) >= 0;

      if (isFolded) {
        notes.push(MigratePlan.foldedNote({ version: opts.older, line }));
        olderEntries.push(...windowOf({ older: opts.older, newer: line, includeFolded: true }));
        lower = line;
        olderItems = stateOf(line).items;
      } else {
        notes.push(
          `${opts.older} was tagged before the folder of ${line} existed: everything in that folder at the other end counts as new`,
        );
      }
    }

    if (lower !== undefined && upper !== undefined && Bun.semver.order(upper, lower) > 0) {
      olderEntries.unshift(...windowOf({ older: lower, newer: upper, includeFolded: false }));
    }

    const [fromItems, toItems] = opts.isUpgrade
      ? [olderItems, newerItems]
      : [newerItems, olderItems];
    const moves = FolderStates.diff({ from: fromItems, to: toItems });
    // The lines the two ends touch: what lies before the older end's line is history the plan does not compare.
    const floor = FolderStates.lineOf({ version: opts.older });
    const touched = [...olderItems, ...newerItems].filter(
      (item) => Bun.semver.order(item.line, floor) >= 0,
    );

    return {
      older: [...new Map(olderEntries.map((entry) => [entry.id, entry])).values()],
      newer: [...new Map(newerEntries.map((entry) => [entry.id, entry])).values()],
      moves,
      notes,
      degraded,
      considered: new Set(touched.map((item) => `${item.line}#${item.id}`)).size,
    };
  }

  private static foldedNote(opts: { version: string; line: string }): string {
    return `${opts.version} is a prerelease of ${opts.line}, which was folded into a version folder after its release: the part of the line on the far side of ${opts.version} is read from the dated entries, and \`changelog:${opts.line}\` (the atlas \`get\` tool) holds the line's net change - read it`;
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

  /**
   * The entries of `package` in (older, newer], newest first, by commit order when the table has it. A missing `older` opens the
   * window before the first release; a missing `newer` closes it after the last (what is not yet released).
   */
  private static window(opts: {
    releases: IReleaseIndex;
    package: string;
    older?: string;
    newer?: string;
    includeFolded?: boolean;
    datedOnly?: boolean;
  }): IChangelogRecord[] {
    const { releases } = opts;
    const at = (version: string | undefined, open: { order: number; date: string }) =>
      version === undefined
        ? open
        : {
            order: releases.releaseOrderOf({ package: opts.package, version }),
            date: releases.releaseDateOf({ package: opts.package, version }) ?? '',
          };
    const lower = at(opts.older, { order: -1, date: '' });
    const upper = at(opts.newer, { order: Number.MAX_SAFE_INTEGER, date: '\uffff' });
    const flags = { includeFolded: opts.includeFolded, datedOnly: opts.datedOnly };

    return lower.order !== undefined && upper.order !== undefined
      ? releases.entriesBetweenOrders({
          package: opts.package,
          fromOrder: lower.order,
          toOrder: upper.order,
          fromDate: lower.date,
          toDate: upper.date,
          ...flags,
        })
      : releases.entriesBetween({
          package: opts.package,
          fromDate: lower.date,
          toDate: upper.date,
          ...flags,
        });
  }
}
