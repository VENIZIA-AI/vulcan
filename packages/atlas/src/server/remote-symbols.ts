import { isAbsolute, relative } from 'node:path';
import type { IPackageMapEntry } from '@/common/package-map';
import type { IAtlasProject } from '@/common/project-config';
import { InstalledPackages } from '@/sources/installed';
import type { IInstalledCopy } from '@/sources/installed';
import { SymbolCompute, SymbolStore } from '@/symbols';
import type { ISymbolOrigin, ISymbolRecord } from '@/symbols';

/** What the symbols of a source need to know of its releases: the newest one. */
interface INewestRelease {
  newestOf(opts: { package: string }): { version: string } | undefined;
}

interface IRemoteSymbolsOptions {
  /** The source project: the packages whose symbols are served. */
  project: IAtlasProject;
  /** The consumer's root: where `node_modules` of the app, and of each package it declares, is looked at. */
  cwd: string;
  cacheBase: string;
  releases: INewestRelease;
}

/**
 * The symbols of a remote source (D2): what the app installed of each package, the exact version it runs, else the
 * newest release npm published, which the pull cached. Resolved against the disk on every question's fingerprint, not
 * once: an install that moves while the server runs (a bump, a `bun install`) is read on the next question.
 */
export class RemoteSymbols {
  /** The first copy at a root, by the real `node_modules/<name>` path: never the package store, never a throwaway tree. */
  private static installedOf(opts: {
    roots: string[];
    name: string;
  }): Required<IInstalledCopy> | undefined {
    const [first] = InstalledPackages.copiesOf(opts);

    return first?.version === undefined
      ? undefined
      : { directory: first.directory, version: first.version };
  }

  private static pathOf(opts: { cwd: string; directory: string }): string {
    const inside = relative(opts.cwd, opts.directory);

    return inside.startsWith('..') || isAbsolute(inside) ? opts.directory : inside;
  }

  static symbolsOf(opts: IRemoteSymbolsOptions): ISymbolRecord[] {
    const roots = InstalledPackages.installRootsOf({ cwd: opts.cwd });

    return opts.project.packages
      .filter((entry) => !entry.retired)
      .flatMap((entry) => {
        const installed = RemoteSymbols.installedOf({ roots, name: entry.name });

        if (installed !== undefined) {
          const origin: ISymbolOrigin = {
            version: installed.version,
            installedAt: RemoteSymbols.pathOf({ cwd: opts.cwd, directory: installed.directory }),
          };

          return SymbolCompute.symbolsOfInstalled({
            directory: installed.directory,
            cacheBase: opts.cacheBase,
          }).map((record) => ({ ...record, origin }));
        }

        const version = opts.releases.newestOf({ package: entry.name })?.version;

        return version === undefined
          ? []
          : (
              SymbolCompute.cached({ name: entry.name, version, cacheBase: opts.cacheBase }) ?? []
            ).map((record) => ({ ...record, origin: { version } }));
      });
  }

  /** What the symbols were read from: the copy and version each package resolves to now. A new value loads them again. */
  static fingerprintOf(opts: IRemoteSymbolsOptions): string {
    const roots = InstalledPackages.installRootsOf({ cwd: opts.cwd });

    return opts.project.packages
      .filter((entry) => !entry.retired)
      .map((entry) => {
        const installed = RemoteSymbols.installedOf({ roots, name: entry.name });

        return installed === undefined
          ? `${entry.name}: npm ${opts.releases.newestOf({ package: entry.name })?.version ?? 'none'}`
          : `${entry.name}: ${installed.version} at ${installed.directory}`;
      })
      .join('\n');
  }

  static storeOf(opts: IRemoteSymbolsOptions & { packageMap: IPackageMapEntry[] }): SymbolStore {
    return new SymbolStore({
      load: () => ({ symbols: RemoteSymbols.symbolsOf(opts), packageMap: opts.packageMap }),
      fingerprint: () => RemoteSymbols.fingerprintOf(opts),
      emptyReason: 'none of its packages is installed here or on npm',
    });
  }
}
