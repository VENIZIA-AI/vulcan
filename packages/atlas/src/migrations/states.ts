import { PRERELEASE_PART, VersionSections } from '@/changelogs/version-folder';
import { MigrateDirections } from './directions';
import type { TStepDirection } from './directions';
import type { IVersionFolder, TVersionSection } from '@/changelogs/version-folder';
import type { TMigrationBlock } from '@/changelogs/version-folder';
import { FolderAtStatuses } from '@/releases/common';
import type { IFolderHistory } from '@/releases/common';

/** One item of a version folder as a package sees it at a version: what the plan diffs. */
export interface IStateItem {
  line: string;
  id: string;
  title: string;
  section: TVersionSection;
  /** The citation id `get` reads the item by. */
  entry: string;
  /** `released:` of its line, or `in progress`. */
  date: string;
  block?: TMigrationBlock;
  /** Over the block, the section and the packages - never the prose: a typo fix changes no plan. */
  hash: string;
}

export interface IPackageState {
  items: IStateItem[];
  /** What was degraded or could not be read, one sentence each; empty for an exact state. */
  notes: string[];
  /** The folder of the version's line could not be read at its tag: the state is an approximation (an earlier tag, or none). */
  degraded?: true;
  /** Set when the version is a prerelease of a line that was folded in after its release: its tag holds no folder, so the state is only the lines before it. */
  folded?: string;
}

/** Which way a step moves the app: undo what an item was, or apply what it is. */
/** An item that moves between two states, in the direction the app must follow. */
export interface IStateMove {
  item: IStateItem;
  /** `downgrade` undoes `item` as the from-state held it; `upgrade` applies it as the to-state holds it. */
  direction: TStepDirection;
  /** The item is in both states and its block, section or packages differ: it is undone, then applied again. */
  changed: boolean;
}

/** The same text for the same value, whatever order its keys were written in. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonical(entry)).join(',')}]`;
  }

  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};

const itemsOf = (opts: { folder: IVersionFolder; package: string }): IStateItem[] =>
  opts.folder.items
    .filter((item) =>
      (item.packages.length === 0 ? opts.folder.packages : item.packages).includes(opts.package),
    )
    .map((item): IStateItem => {
      const block = opts.folder.blocks[item.id];
      // Only what the item itself says: the folder's own list decides who sees the item (above), and a package joining it
      // must not make every item that inherits it look changed.
      const packages = [...item.packages].sort();
      const state: IStateItem = {
        line: opts.folder.name,
        id: item.id,
        title: item.title,
        section: item.section,
        entry: `changelog:${opts.folder.name}#${item.id}`,
        date: opts.folder.released ?? 'in progress',
        hash: new Bun.CryptoHasher('sha256')
          .update(canonical({ block: block ?? null, section: item.section, packages }))
          .digest('hex'),
      };

      if (block !== undefined) {
        state.block = block;
      }

      return state;
    });

/**
 * `state(package, version)`: the items a package is on at a version - the final folders of every earlier line, and the
 * folder of the version's own line: at HEAD for a stable (a released line is frozen), as the package's tag held it for a
 * prerelease. Read from git only for a prerelease, and only the one folder.
 */
export class FolderStates {
  static lineOf(opts: { version: string }): string {
    return opts.version.replace(PRERELEASE_PART, '');
  }

  static isOwing(opts: { item: IStateItem }): boolean {
    return VersionSections.OWING.includes(opts.item.section);
  }

  static stateOf(opts: {
    history: IFolderHistory;
    package: string;
    version: string;
    /** Every version of the package, newest first: a tag that cannot be read falls back to the nearest earlier one of its line. */
    versions: string[];
  }): IPackageState {
    const line = FolderStates.lineOf(opts);
    const heads = opts.history.folders();
    const earlier = heads
      .filter((folder) => Bun.semver.order(folder.name, line) < 0)
      .flatMap((folder) => itemsOf({ folder, package: opts.package }));
    const own = heads.find((folder) => folder.name === line);
    const state: IPackageState = { items: earlier, notes: [] };

    if (own === undefined) {
      return state;
    }

    if (opts.version === line) {
      state.items.push(...itemsOf({ folder: own, package: opts.package }));

      return state;
    }

    const candidates = [
      opts.version,
      ...opts.versions.filter(
        (version) =>
          version !== opts.version &&
          FolderStates.lineOf({ version }) === line &&
          version !== line &&
          Bun.semver.order(version, opts.version) < 0,
      ),
    ];
    const failures: string[] = [];

    for (const version of candidates) {
      const found = opts.history.at({ package: opts.package, version, line });

      if (found.status === FolderAtStatuses.FOLDER) {
        state.items.push(...itemsOf({ folder: found.folder, package: opts.package }));

        if (version !== opts.version) {
          state.degraded = true;
          state.notes.push(
            `${opts.package} ${opts.version} could not be read (${failures.join('; ')}): its folder ${line} is read at ${found.tag}, the nearest earlier tag of the line, so a change made since may be missing`,
          );
        }

        return state;
      }

      if (found.status === FolderAtStatuses.ABSENT) {
        state.folded = line;

        if (failures.length > 0) {
          state.degraded = true;
          state.notes.push(
            `${opts.package} ${opts.version} could not be read (${failures.join('; ')}); the nearest readable tag ${found.tag} holds no folder of ${line}, so the line is treated as folded`,
          );
        }

        return state;
      }

      failures.push(found.reason);
    }

    state.degraded = true;
    state.notes.push(
      `${opts.package} ${opts.version}: its folder ${line} could not be read at any tag of the line (${failures.join('; ')}); only the lines before ${line} are counted`,
    );

    return state;
  }

  /**
   * The moves from one state to another: what leaves is undone (newest line first, last item first), then what arrives
   * is applied (oldest line first, file order). An item in both with the same hash moves nothing.
   */
  static diff(opts: { from: IStateItem[]; to: IStateItem[] }): IStateMove[] {
    const key = (item: IStateItem): string => `${item.line}#${item.id}`;
    const fromByKey = new Map(opts.from.map((item) => [key(item), item]));
    const toByKey = new Map(opts.to.map((item) => [key(item), item]));
    const downgrades = [...opts.from]
      .reverse()
      .filter((item) => toByKey.get(key(item))?.hash !== item.hash)
      .map((item): IStateMove => ({
        item,
        direction: MigrateDirections.DOWNGRADE,
        changed: toByKey.has(key(item)),
      }));
    const upgrades = opts.to
      .filter((item) => fromByKey.get(key(item))?.hash !== item.hash)
      .map((item): IStateMove => ({
        item,
        direction: MigrateDirections.UPGRADE,
        changed: fromByKey.has(key(item)),
      }));

    return [...downgrades, ...upgrades];
  }
}
