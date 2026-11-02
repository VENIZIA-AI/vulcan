import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { AtlasConstants, AtlasModes } from '@/common';
import { RepositoryRoots } from '@/corpus';
import { RpcError, Transport } from '@/protocol';
import type { IToolHandler } from '@/protocol/common';
import { ReleaseCompute, ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { InstalledPackages } from '@/sources/installed';
import { SourceResolver } from '@/sources/resolver';
import { SourceChunks, SourceReleases, SourceSymbols } from '@/sources/serving';
import type { IAtlasSource, IResolvedSource, IUnavailableSource } from '@/sources/common';
import { SymbolCompute, SymbolStore } from '@/symbols';
import type { ISymbolRecord } from '@/symbols';
import { ChangesTool, GetTool, PresetsTool, SearchTool, SymbolTool, VersionTool } from '@/tools';
import { SkillCatalog } from '@/skills';
import { FreshnessGuard } from './freshness';
import { ServerGuidance } from './guidance';
import { SourceBoot } from './boot';
import { SourceNotice } from './notice';
import { Refresher } from './refresh';
import type { IRefreshTarget } from './refresh';

const packageMapOf = (opts: { source: IResolvedSource }) =>
  opts.source.project.packages.map((entry) => ({
    dir: entry.dir,
    name: entry.name,
    aliases: entry.aliases,
  }));

/**
 * A remote source's symbols, D2: what the consumer installed of each package - the exact version it
 * runs - else the newest release npm published, which the pull cached.
 */
const remoteSymbolsOf = (opts: {
  source: IResolvedSource;
  cwd: string;
  releases: ReleaseStore;
}): ISymbolRecord[] => {
  const { cacheBase } = opts.source;

  if (cacheBase === undefined) {
    throw new Error(`atlas: remote source '${opts.source.name}' was resolved without a cache base`);
  }

  return opts.source.project.packages
    .filter((entry) => !entry.retired)
    .flatMap((entry) => {
      const [installed] = InstalledPackages.installedDirectoriesOf({
        roots: InstalledPackages.installRootsOf({ cwd: opts.cwd }),
        name: entry.name,
      });

      if (installed !== undefined) {
        return SymbolCompute.symbolsOfInstalled({ directory: installed, cacheBase });
      }

      const version = opts.releases.newestOf({ package: entry.name })?.version;

      return version === undefined
        ? []
        : (SymbolCompute.cached({ name: entry.name, version, cacheBase }) ?? []);
    });
};

/** D1: a source fetched without git has no history; anything else has none of the tags it declares. */
const emptyReleasesReasonOf = (opts: { source: IResolvedSource }): string =>
  opts.source.history === false
    ? `no release history: ${opts.source.name} was fetched without git`
    : `no releases: no tag matches ${opts.source.project.tagPattern} in this ref's history`;

const CHANGELOG_LAYOUT =
  'atlas reads files named YYYY-MM-DD-<slug>.md from it, each with `packages: [<npm name>, ...]` frontmatter';

/** Where a date window looked for dated entries - the directory the manifest declares, or that it declares none. */
const noEntriesReasonOf = (opts: { source: IResolvedSource }): string => {
  const { root, knowledge } = opts.source.project;

  return knowledge.changelogs === undefined
    ? `no dated changelog entries: the manifest declares no changelog directory - set knowledge.changelogs; ${CHANGELOG_LAYOUT}`
    : `no dated changelog entries in ${relative(root, knowledge.changelogs)} - ${CHANGELOG_LAYOUT}`;
};

const storesOf = (opts: { source: IResolvedSource; cwd: string }) => {
  const { source } = opts;
  const packageMap = packageMapOf({ source });

  if (source.mode === 'repository') {
    const guard = new FreshnessGuard({
      mode: AtlasModes.REPOSITORY,
      roots: RepositoryRoots.resolve({ project: source.project }),
    });

    return {
      name: source.name,
      chunks: () => guard.getStore(),
      releases: new ReleaseStore({
        table: ReleaseCompute.compute({ project: source.project }),
        emptyReason: emptyReleasesReasonOf({ source }),
        noEntriesReason: noEntriesReasonOf({ source }),
      }),
      symbols: new SymbolStore({
        load: () => ({
          symbols: SymbolCompute.symbolsOfRepository({ project: source.project }),
          packageMap,
        }),
        fingerprint: () => SymbolCompute.declarationsFingerprintOf({ project: source.project }),
        emptyReason: "no symbols - build the packages first: atlas reads their exports' .d.ts",
      }),
    };
  }

  const index = new ChunkStore({ serialized: readFileSync(source.indexFile ?? '') });
  const releases = new ReleaseStore({
    table: JSON.parse(readFileSync(source.releasesFile ?? '', 'utf8')),
    emptyReason: emptyReleasesReasonOf({ source }),
    noEntriesReason: noEntriesReasonOf({ source }),
  });

  return {
    name: source.name,
    chunks: () => index,
    releases,
    symbols: new SymbolStore({
      load: () => ({ symbols: remoteSymbolsOf({ ...opts, releases }), packageMap }),
      emptyReason: 'none of its packages is installed here or on npm',
    }),
  };
};

type TStoreSet = ReturnType<typeof storesOf>;

/**
 * A source's stores behind getters, so a refresh can replace them in place: the composites read
 * `chunks`, `releases` and `symbols` from the entry on every call.
 */
const liveEntry = (opts: { initial: TStoreSet }) => {
  let current = opts.initial;

  return {
    get name() {
      return current.name;
    },
    get chunks() {
      return current.chunks;
    },
    get releases() {
      return current.releases;
    },
    get symbols() {
      return current.symbols;
    },
    replace: (next: TStoreSet): void => {
      current = next;
    },
    replaceReleases: (releases: ReleaseStore): void => {
      current = { ...current, releases };
    },
  };
};

type TLiveEntry = ReturnType<typeof liveEntry>;

const timeOf = (opts: { file?: string }): number =>
  opts.file !== undefined && existsSync(opts.file) ? statSync(opts.file).mtimeMs : 0;

/** HEAD and every tag of the project's own repository: what changes when a release lands. */
const repositoryFingerprintOf = (opts: { root: string }): string => {
  const run = (args: string[]): string =>
    spawnSync('git', args, { cwd: opts.root, encoding: 'utf8', timeout: 10_000 }).stdout ?? '';

  return `${run(['rev-parse', '--verify', '--quiet', 'HEAD'])}${run(['for-each-ref', 'refs/tags', '--format=%(objectname) %(refname)'])}`;
};

/** Asks again for one remote source: a moved ref or a refreshed release table replaces its stores. */
const remoteTarget = (opts: {
  entry: TLiveEntry;
  served: IResolvedSource;
  cwd: string;
  resolve: (source: IAtlasSource) => Promise<IResolvedSource>;
}): IRefreshTarget | undefined => {
  let { served } = opts;
  const { declared } = served;

  if (declared === undefined) {
    return undefined;
  }

  return {
    refresh: async () => {
      const next = await opts.resolve(declared);

      if (
        next.sha === served.sha &&
        timeOf({ file: next.releasesFile }) === timeOf({ file: served.releasesFile })
      ) {
        return;
      }

      opts.entry.replace(storesOf({ source: next, cwd: opts.cwd }));
      served = next;
    },
  };
};

/** The project's own release table again when HEAD or a tag moved; its search index already watches the files. */
const repositoryTarget = (opts: { entry: TLiveEntry; source: IResolvedSource }): IRefreshTarget => {
  let seen = repositoryFingerprintOf({ root: opts.source.root });

  return {
    refresh: async () => {
      const now = repositoryFingerprintOf({ root: opts.source.root });

      if (now === seen) {
        return;
      }

      opts.entry.replaceReleases(
        new ReleaseStore({
          table: ReleaseCompute.compute({ project: opts.source.project }),
          emptyReason: emptyReleasesReasonOf({ source: opts.source }),
          noEntriesReason: noEntriesReasonOf({ source: opts.source }),
        }),
      );
      seen = now;
    },
  };
};

interface IRefreshOptions {
  /** How often a running server looks again; the first look comes this long after the start. */
  intervalMs: number;
  /** How a remote source is asked again - the resolver, unless a test supplies another. */
  resolve?: (source: IAtlasSource) => Promise<IResolvedSource>;
  now?: () => number;
}

export class SourcesServer {
  /**
   * The MCP transport over every resolved source (spec v3 section 3): one store set per source,
   * served as one by the composites - a single repository answers exactly as it always has.
   */
  static build(opts: {
    sources: IResolvedSource[];
    /** Sources this start could not serve; `initialize` names each with its reason. */
    unavailable?: IUnavailableSource[];
    cwd: string;
    /** Where atlas keeps what it fetches; absent, `<cwd>/.agents/local/cache`. */
    cacheDir?: string;
    /** Whether a refresh may download a prebuilt index (default yes). */
    prebuilt?: boolean;
    version: string;
    /** Keeps a long-running server current; absent, the sources stay as the start resolved them. */
    refresh?: IRefreshOptions;
    /**
     * Remote sources still to be fetched and indexed. The server answers at once; each source joins
     * as it is ready, and a call waits a bounded time for the ones missing and says which it left out.
     */
    boot?: SourceBoot;
  }): Transport {
    const { boot } = opts;
    const served = [...opts.sources];
    const stores = opts.sources.map((source) =>
      liveEntry({ initial: storesOf({ source, cwd: opts.cwd }) }),
    );
    const chunks = new SourceChunks({ sources: stores });
    const releases = new SourceReleases({ sources: stores });
    const symbols = new SourceSymbols({ sources: stores });
    const project = opts.sources.find((source) => source.mode === 'repository');
    // Read when a client connects: a skill added, renamed or deleted since the start shows at once.
    const instructions = (): string =>
      ServerGuidance.instructionsOf({
        sources: served,
        unavailable: [...(opts.unavailable ?? []), ...(boot?.unavailable() ?? [])],
        indexing: boot?.indexing() ?? [],
        skills: SkillCatalog.catalogOf({ root: opts.cwd }).map((entry) => ({
          name: entry.name,
          trigger: SkillCatalog.triggerOf({ description: entry.description }).text,
        })),
      });
    const projects = ServerGuidance.projectsOf({
      sources: opts.sources,
      indexing: boot?.declared ?? [],
    });
    const resolve =
      opts.refresh?.resolve ??
      ((source: IAtlasSource) =>
        SourceResolver.resolveRemote({
          source,
          cwd: opts.cwd,
          cacheDir: opts.cacheDir,
          prebuilt: opts.prebuilt,
        }));
    const makeTarget = (opts2: { entry: TLiveEntry; source: IResolvedSource }) =>
      opts2.source.mode === 'repository'
        ? repositoryTarget(opts2)
        : remoteTarget({ entry: opts2.entry, served: opts2.source, cwd: opts.cwd, resolve });
    const targets = opts.sources.flatMap((source, index): IRefreshTarget[] => {
      const target = makeTarget({ entry: stores[index], source });

      return target === undefined ? [] : [target];
    });
    const refresher =
      opts.refresh === undefined
        ? undefined
        : new Refresher({
            targets,
            intervalMs: opts.refresh.intervalMs,
            now: opts.refresh.now,
          });

    const order = (name: string): number =>
      boot?.declared.findIndex((source) => source.name === name) ?? -1;

    boot?.listen({
      onReady: ({ resolved }) => {
        const entry = liveEntry({ initial: storesOf({ source: resolved, cwd: opts.cwd }) });
        const target = makeTarget({ entry, source: resolved });

        // The config's order, whichever source finishes first: the composites read these arrays on every call.
        stores.push(entry);
        stores.sort((left, right) => order(left.name) - order(right.name));
        served.push(resolved);
        served.sort((left, right) => order(left.name) - order(right.name));

        if (target !== undefined) {
          targets.push(target);
        }
      },
    });

    // A call waits a bounded time for sources still indexing, then answers from the ready ones and says which it left out.
    const guarded = (handler: IToolHandler): IToolHandler =>
      boot === undefined
        ? handler
        : {
            definition: handler.definition,
            call: async (input) => {
              await boot.waitFor({ ms: SourceBoot.callWaitMs() });

              const left = SourceNotice.of({
                boot,
                answeredFrom: served.map((entry) => entry.name),
              });

              try {
                const result = await handler.call(input);

                return SourceNotice.attach({ result, notice: left });
              } catch (error) {
                throw left !== undefined && error instanceof RpcError
                  ? new RpcError({
                      code: error.code,
                      message: `${error.message} (${left.message})`,
                    })
                  : error;
              }
            },
          };

    const transport = new Transport({
      tools: [
        guarded(SearchTool.build({ store: chunks, symbols, projects })),
        guarded(GetTool.build({ store: chunks })),
        guarded(SymbolTool.build({ store: chunks, symbols, projects })),
        guarded(VersionTool.build({ releases, projects })),
        guarded(ChangesTool.build({ releases, projects })),
        PresetsTool.build({ project: project?.project, projects }),
      ],
      // A project names its server whatever sources ride with it: a name that moved with the network
      // (a source reachable or not) would break a client configured by name.
      serverName: project === undefined ? AtlasConstants.SERVER_NAME : `${project.name}-atlas`,
      serverVersion: opts.version,
      instructions,
      onCall: () => refresher?.poke(),
    });

    boot?.start();

    return transport;
  }
}
