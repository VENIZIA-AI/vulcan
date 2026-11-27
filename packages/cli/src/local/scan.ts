import { ProjectTmp } from '../hooks/project-tmp.ts';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { EventRetention } from '../events/retention.ts';
import { EventSettings } from '../events/settings.ts';
import type { ILocalEntry } from './common/index.ts';
import { CleanScopes, LocalConstants, LocalProtected, LocalStates } from './constants.ts';
import { GitReader } from './git-reader.ts';
import { DirectoryUtility } from './utilities/directory.utility.ts';
import { WorktreeReader } from './worktree-reader.ts';

/** The newest modification time under `path`, itself included: a folder's own time moves only when its direct children do. */
const newestModifiedAt = (opts: { path: string }): number => {
  let stat;

  try {
    stat = lstatSync(opts.path);
  } catch {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  return readdirSync(opts.path).reduce(
    (newest, name) => Math.max(newest, newestModifiedAt({ path: join(opts.path, name) })),
    stat.mtimeMs,
  );
};

/** The bytes under `path`, symlinks counted as themselves and never followed. */
const sizeOf = (opts: { path: string }): number => {
  let stat;

  try {
    stat = lstatSync(opts.path);
  } catch {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.size;
  }

  return readdirSync(opts.path).reduce(
    (total, name) => total + sizeOf({ path: join(opts.path, name) }),
    0,
  );
};

/** Whether a release version has a tag in the repository: `v<version>` or `<version>`. */
class ReleaseTags {
  /** Whether `name` is a version (`LocalConstants.RELEASE_VERSION`); any other name is no candidate and never matched against a tag. */
  static isVersion(opts: { name: string }): boolean {
    return LocalConstants.RELEASE_VERSION.test(opts.name);
  }

  static isTagged(opts: { root: string; version: string }): boolean {
    const bare = opts.version.replace(/^v/, '');

    return [`v${bare}`, bare].some(
      (tag) =>
        GitReader.run({
          cwd: opts.root,
          args: ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`],
        }) !== undefined,
    );
  }
}

export class LocalScan {
  /**
   * The real path of the project's `.agents/local/`, or `undefined` when there is none or it cannot be
   * trusted: `.agents` or `.agents/local` is a symlink, or the folder resolves outside the project. Every
   * scan and every removal starts here, so a link can never move them out of the project.
   */
  static localRootOf(opts: { root: string }): string | undefined {
    const agents = join(opts.root, '.agents');
    const local = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);

    try {
      if (lstatSync(agents).isSymbolicLink() || lstatSync(local).isSymbolicLink()) {
        return undefined;
      }

      const real = realpathSync(local);
      const realRoot = realpathSync(opts.root);

      return real.startsWith(`${realRoot}${sep}`) && lstatSync(real).isDirectory()
        ? real
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Every entry of `.agents/local/`, with size, age and what may be removed. Nothing is followed outside it. */
  static scan(opts: { root: string; now?: number; only?: string[] }): ILocalEntry[] {
    const local = LocalScan.localRootOf({ root: opts.root });
    const now = opts.now ?? Date.now();

    if (local === undefined) {
      return [];
    }

    // `only` names the folders to look at: the automatic clean asks for two and never starts git for the worktrees.
    const wants = (name: string): boolean => opts.only === undefined || opts.only.includes(name);
    const registered = wants(CleanScopes.WORKTREES)
      ? WorktreeReader.registeredWorktrees({ root: opts.root })
      : undefined;
    const entries: ILocalEntry[] = [];
    // The event log is where the project's settings put it (`events.dir`, else `.agents/local/events`), with its limits.
    const eventSettings = EventSettings.read({ root: opts.root });
    const eventsDir = EventSettings.dirOf({ root: opts.root, settings: eventSettings });
    const eventPlan = wants(CleanScopes.EVENTS)
      ? EventRetention.plan({
          dir: eventsDir,
          limits: EventRetention.limitsOf({ settings: eventSettings }),
          now,
        })
      : undefined;
    const isEventsOutside = !`${eventsDir}${sep}`.startsWith(`${local}${sep}`);

    const homes: Record<string, string> = {
      [CleanScopes.EVENTS]: eventsDir,
      [CleanScopes.TMP]: ProjectTmp.projectOf({ root: opts.root }),
    };

    for (const layout of ProjectLayout.LOCAL_LAYOUT) {
      if (!wants(layout.name)) {
        continue;
      }

      const isEvents = layout.name === CleanScopes.EVENTS;
      // The scratch folder of an earlier release, `.agents/local/tmp`, is listed with the new one until nothing is left in it.
      const directories = [
        ...new Set([
          homes[layout.name] ?? join(local, layout.name),
          ...(layout.name === CleanScopes.TMP ? [join(local, layout.name)] : []),
        ]),
      ].filter((path) => DirectoryUtility.isReal({ path }));

      for (const directory of directories) {
        for (const name of readdirSync(directory)) {
          if (name === '.gitkeep') {
            continue;
          }

          const path = join(directory, name);
          const stat = lstatSync(path);
          const ageMs = now - newestModifiedAt({ path });
          const staleAfter =
            'staleAfterDays' in layout ? layout.staleAfterDays * LocalConstants.DAY_MS : undefined;
          let state: string = LocalStates.OK;
          let removable = true;
          let isRegistered = false;
          let note = '';

          if (layout.name === CleanScopes.WORKTREES) {
            const verdict = WorktreeReader.classify({
              root: opts.root,
              real: stat.isSymbolicLink() ? resolve(path) : realpathSync(path),
              registered,
            });

            ({ state, removable, registered: isRegistered, note } = verdict);
          } else if (layout.name === CleanScopes.EVENTS) {
            // Day files are removed by the limits of `events` (age, count, size), never all at once and never today's.
            const goes = eventPlan?.remove.find((file) => file.name === name);

            ({ removable, note } =
              goes === undefined
                ? {
                    removable: false,
                    note: 'within the limits of events (maxSize, maxFiles, maxAgeDays)',
                  }
                : { removable: true, note: goes.reason });
          } else if (layout.name === CleanScopes.RELEASE_CANDIDATES) {
            // A candidate is named by its version: once that version is tagged the release has shipped.
            const isShipped =
              ReleaseTags.isVersion({ name }) &&
              ReleaseTags.isTagged({ root: opts.root, version: name });

            ({ state, removable, note } = isShipped
              ? {
                  state: LocalStates.SHIPPED,
                  removable: true,
                  note: `version ${name} is tagged: the release shipped`,
                }
              : {
                  state: LocalStates.OK,
                  removable: false,
                  note: ReleaseTags.isVersion({ name })
                    ? `version ${name} is not tagged yet`
                    : `${name} is not a version (1.2.3, v1.2.3 or 1.2.3-rc.1): kept`,
                });
          } else if (staleAfter !== undefined && ageMs > staleAfter) {
            state = LocalStates.STALE;
          }

          const inUse = LocalProtected.noteOf({ scope: layout.name, name });

          if (inUse !== undefined) {
            // Not stale either: it is in use, and doctor must not tell anyone to clean what clean never takes.
            ({ state, removable, note } = { state: LocalStates.OK, removable: false, note: inUse });
          }

          entries.push({
            scope: layout.name,
            name,
            // An event log kept outside the project is named by its whole path.
            where: isEvents && isEventsOutside ? path : `${layout.name}/${name}`,
            path,
            bytes: sizeOf({ path }),
            ageMs,
            state,
            removable,
            isSymlink: stat.isSymbolicLink(),
            registered: isRegistered,
            note,
            ...(isEvents && isEventsOutside ? { outside: true } : {}),
          });
        }
      }
    }

    const profile = join(local, 'profile.json');

    if (wants(CleanScopes.PROFILE) && existsSync(profile)) {
      const stat = lstatSync(profile);

      entries.push({
        scope: CleanScopes.PROFILE,
        name: 'profile.json',
        where: 'profile.json',
        path: profile,
        bytes: stat.size,
        ageMs: now - stat.mtimeMs,
        state: LocalStates.OK,
        removable: true,
        isSymlink: stat.isSymbolicLink(),
        registered: false,
        note: 'your answers only: the keys of this machine (agents, board, local, events) stay',
      });
    }

    return [...entries, ...(wants(CleanScopes.TMP) ? LocalScan.strays({ local, now }) : [])];
  }

  /**
   * Scratch folders a browser left directly under `.agents/local/` (its temp folder, when that was the short
   * one): scope `tmp`, removable once they are old enough not to belong to a browser that is running.
   */
  private static strays(opts: { local: string; now: number }): ILocalEntry[] {
    return readdirSync(opts.local)
      .filter((name) => LocalConstants.STRAY_TEMP.some((pattern) => pattern.test(name)))
      .map((name) => {
        const path = join(opts.local, name);
        const stat = lstatSync(path);
        const ageMs = opts.now - newestModifiedAt({ path });
        const isOld = ageMs > LocalConstants.STRAY_MIN_AGE_MS;

        return {
          scope: CleanScopes.TMP,
          name,
          where: name,
          path,
          bytes: sizeOf({ path }),
          ageMs,
          state: isOld ? LocalStates.STALE : LocalStates.OK,
          removable: isOld,
          isSymlink: stat.isSymbolicLink(),
          registered: false,
          note: isOld ? 'a browser left it' : 'younger than an hour: a browser may be using it',
        };
      });
  }

  /**
   * What sits directly under `.agents/local/` and is neither a folder of the layout, a file VULCAN writes, nor
   * a browser's scratch folder: nobody removes it, `doctor` names it.
   */
  static unknown(opts: { root: string }): { name: string; bytes: number }[] {
    const local = LocalScan.localRootOf({ root: opts.root });

    if (local === undefined) {
      return [];
    }

    const known = new Set<string>(ProjectLayout.LOCAL_LAYOUT.map((entry) => entry.name));

    return readdirSync(local)
      .filter(
        (name) =>
          !known.has(name) &&
          !LocalConstants.KNOWN_FILES.has(name) &&
          !LocalConstants.STRAY_TEMP.some((pattern) => pattern.test(name)),
      )
      .sort()
      .map((name) => ({ name, bytes: sizeOf({ path: join(local, name) }) }));
  }

  /**
   * Whether `path` sits under the project's trusted `.agents/local/` once its parent is resolved; a final
   * symlink is not followed. A symlinked `.agents` or `.agents/local` makes it false for everything.
   */
  static isInside(opts: { root: string; path: string }): boolean {
    const bases = [
      LocalScan.localRootOf({ root: opts.root }),
      LocalScan.tmpRootOf({ root: opts.root }),
    ].filter((base): base is string => base !== undefined);
    const parent = resolve(opts.path, '..');

    if (bases.length === 0 || !existsSync(parent)) {
      return false;
    }

    const target = join(realpathSync(parent), resolve(opts.path).split(sep).at(-1) ?? '');

    return bases.some((base) => target.startsWith(`${base}${sep}`));
  }

  /**
   * The project's tmp folder as the disk has it, when it is a real folder (not a link) that sits inside the project, and
   * `clean` may therefore remove from it; undefined when it is missing, a link, or leads out of the project.
   */
  static tmpRootOf(opts: { root: string }): string | undefined {
    const folder = ProjectTmp.projectOf({ root: opts.root });

    try {
      if (!lstatSync(folder).isDirectory()) {
        return undefined;
      }

      const real = realpathSync(folder);

      return `${real}${sep}`.startsWith(`${realpathSync(opts.root)}${sep}`) ? real : undefined;
    } catch {
      return undefined;
    }
  }
}
