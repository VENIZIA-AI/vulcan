import { spawnSync } from 'node:child_process';
import { AtlasGit } from '@/common/constants';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { AtlasConstants } from '@/common';
import { RepositoryRoots } from '@/corpus';
import { RpcError, Transport } from '@/protocol';
import type { IToolHandler } from '@/protocol/common';
import { ReleaseCompute } from '@/releases';
import type { ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { SourceResolver } from '@/sources/resolver';
import { SourceChunks, SourceReleases, SourceSymbols } from '@/sources/serving';
import type { IAtlasSource, IResolvedSource, IUnavailableSource } from '@/sources/common';
import { SymbolCompute, SymbolStore } from '@/symbols';
import {
  ChangesTool,
  GetTool,
  MigrateTool,
  PresetsTool,
  SearchTool,
  SymbolTool,
  VersionTool,
} from '@/tools';
import { SkillCatalog } from '@/skills';
import { FreshnessGuard } from './freshness';
import { ServerGuidance } from './guidance';
import { SourceBoot } from './boot';
import { SourceNotice } from './notice';
import { Refresher } from './refresh';
import { RemoteSymbols } from './remote-symbols';
import { ServedReleases } from './served-releases';
import type { IRefreshTarget } from './refresh';

const packageMapOf = (opts: { source: IResolvedSource }) =>
  opts.source.project.packages.map((entry) => ({
    dir: entry.dir,
    name: entry.name,
    aliases: entry.aliases,
  }));

const storesOf = (opts: { source: IResolvedSource; cwd: string }) => {
  const { source } = opts;
  const packageMap = packageMapOf({ source });

  if (source.mode === 'repository') {
    const guard = new FreshnessGuard({
      roots: RepositoryRoots.resolve({ project: source.project }),
    });

    return {
      name: source.name,
      chunks: () => guard.getStore(),
      releases: ServedReleases.storeOf({
        source,
        table: ReleaseCompute.compute({ project: source.project }),
      }),
      symbols: new SymbolStore({
        load: () => ({
          symbols: SymbolCompute.symbolsOfRepository({ project: source.project, withSource: true }),
          packageMap,
        }),
        fingerprint: () => SymbolCompute.declarationsFingerprintOf({ project: source.project }),
        emptyReason: "no symbols - build the packages first: atlas reads their exports' .d.ts",
      }),
    };
  }

  const { cacheBase } = source;

  if (cacheBase === undefined) {
    throw new Error(`atlas: remote source '${source.name}' was resolved without a cache base`);
  }

  const index = new ChunkStore({ serialized: readFileSync(source.indexFile ?? '') });
  const releases = ServedReleases.storeOf({
    source,
    table: JSON.parse(readFileSync(source.releasesFile ?? '', 'utf8')),
  });

  return {
    name: source.name,
    chunks: () => index,
    releases,
    symbols: RemoteSymbols.storeOf({
      project: source.project,
      cwd: opts.cwd,
      cacheBase,
      releases,
      packageMap,
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
    spawnSync('git', args, {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: 10_000,
      env: AtlasGit.buildEnvironment(),
    }).stdout ?? '';

  return `${run(['rev-parse', '--verify', '--quiet', 'HEAD'])}${run(['for-each-ref', 'refs/tags', '--format=%(objectname) %(refname)'])}`;
};

/** Asks again for one remote source: a moved ref or a refreshed release table replaces its stores. */
const remoteTarget = (opts: {
  entry: TLiveEntry;
  served: IResolvedSource;
  cwd: string;
  resolve: (source: IAtlasSource) => Promise<IResolvedSource>;
  /** True while the boot's child is still building this source. */
  isBusy?: () => boolean;
}): IRefreshTarget | undefined => {
  let { served } = opts;
  const { declared } = served;

  if (declared === undefined) {
    return undefined;
  }

  return {
    refresh: async () => {
      // A child of the boot is still pulling this source: a second pull would overlap it, and the build replaces what is served.
      if (opts.isBusy?.() === true) {
        return;
      }

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
        ServedReleases.storeOf({
          source: opts.source,
          table: ReleaseCompute.compute({ project: opts.source.project }),
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
        : remoteTarget({
            entry: opts2.entry,
            served: opts2.source,
            cwd: opts.cwd,
            resolve,
            isBusy: () =>
              boot
                ?.progress()
                .some((item) => item.source === opts2.source.name && item.state === 'building') ===
              true,
          });
    const targetOf = new Map<string, IRefreshTarget>();
    const targets = opts.sources.flatMap((source, index): IRefreshTarget[] => {
      const target = makeTarget({ entry: stores[index], source });

      if (target !== undefined) {
        targetOf.set(source.name, target);
      }

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
      onReady: ({ resolved, isReplacement }) => {
        const existing = stores.find((store) => store.name === resolved.name);

        // The source was served from its last good index: the fresh one replaces its stores in place.
        if (isReplacement === true && existing !== undefined) {
          existing.replace(storesOf({ source: resolved, cwd: opts.cwd }));
          served.splice(
            served.findIndex((entry) => entry.name === resolved.name),
            1,
            resolved,
          );

          // The refresh target compares against what it was given: a new one, so the next look does not rebuild what just landed.
          const next = makeTarget({ entry: existing, source: resolved });
          const old = targetOf.get(resolved.name);

          if (old !== undefined) {
            targets.splice(targets.indexOf(old), 1);
          }

          if (next !== undefined) {
            targets.push(next);
            targetOf.set(resolved.name, next);
          }

          return;
        }

        const entry = liveEntry({ initial: storesOf({ source: resolved, cwd: opts.cwd }) });
        const target = makeTarget({ entry, source: resolved });

        // The config's order, whichever source finishes first: the composites read these arrays on every call.
        stores.push(entry);
        stores.sort((left, right) => order(left.name) - order(right.name));
        served.push(resolved);
        served.sort((left, right) => order(left.name) - order(right.name));

        if (target !== undefined) {
          targets.push(target);
          targetOf.set(resolved.name, target);
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
              const named = (input.args as { source?: unknown } | undefined)?.source;

              // A call that names a source waits for that one only; any other waits for all of them.
              await boot.waitFor({
                ms: SourceBoot.callWaitMs(),
                ...(typeof named === 'string' ? { source: named } : {}),
              });

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
        guarded(MigrateTool.build({ releases, projects })),
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
