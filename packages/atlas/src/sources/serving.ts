import type { IChunk } from '@/corpus';
import { packageAcrossSources } from '@/common/package-map';
import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { IChangelogRecord, IReleaseRecord, ReleaseStore } from '@/releases';
import type { IHit } from '@/search/common';
import type { ChunkStore } from '@/search/store';
import type { ISymbolRecord, SymbolStore } from '@/symbols';

const byText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

/** `undefined` when exactly one candidate holds it; an error naming them when several do. */
const onlyOne = <T>(opts: { id: string; found: { source: string; value: T }[] }): T | undefined => {
  if (opts.found.length > 1) {
    throw new RpcError({
      code: RpcErrorCodes.INVALID_PARAMS,
      message: `id '${opts.id}' is in more than one source (${opts.found.map(entry => entry.source).join(', ')}) - pass source`,
    });
  }

  return opts.found[0]?.value;
};

/**
 * One search index per source, served as one: a query runs in each, the hits merge by score, every
 * hit names its source. Ids stay as each source writes them; \`get\` needs \`source\` only when two
 * sources hold the same id. With one source, every call passes straight through.
 */
export class SourceChunks {
  private readonly sources: { name: string; chunks: () => ChunkStore }[];

  constructor(opts: { sources: { name: string; chunks: () => ChunkStore }[] }) {
    this.sources = opts.sources;
  }

  search(opts: { query: string; corpus?: IHit['corpus']; limit: number; offset: number }): {
    total: number;
    hits: IHit[];
  } {
    // Each source answers its first offset+limit, so the merged page is exact.
    const results = this.sources.map(source => ({
      source: source.name,
      result: source.chunks().search({ ...opts, limit: opts.offset + opts.limit, offset: 0 }),
    }));
    const merged = results
      .flatMap(({ source, result }) => result.hits.map(hit => ({ ...hit, source })))
      .sort((left, right) => left.score - right.score);

    return {
      total: results.reduce((sum, { result }) => sum + result.total, 0),
      hits: merged.slice(opts.offset, opts.offset + opts.limit),
    };
  }

  get(opts: { id: string; source?: string }): (IChunk & { source: string }) | undefined {
    const found = this.within({ source: opts.source }).flatMap(source => {
      const value = source.chunks().get({ id: opts.id });

      return value === undefined
        ? []
        : [{ source: source.name, value: { ...value, source: source.name } }];
    });

    return onlyOne({ id: opts.id, found });
  }

  list(opts: { document: string; source?: string }): IChunk[] {
    const found = this.within({ source: opts.source }).flatMap(source => {
      const value = source.chunks().list({ document: opts.document });

      return value.length === 0 ? [] : [{ source: source.name, value }];
    });

    return onlyOne({ id: opts.document, found }) ?? [];
  }

  private within(opts: { source?: string }): { name: string; chunks: () => ChunkStore }[] {
    return opts.source === undefined
      ? this.sources
      : this.sources.filter(source => source.name === opts.source);
  }
}

/**
 * One release table per source, served as one. A package belongs to exactly one source - its npm
 * name says which (C2); a directory or alias two sources share is an error naming the npm names.
 * Date windows span every source; every entry names its source.
 */
export class SourceReleases {
  private readonly sources: { name: string; releases: ReleaseStore }[];

  constructor(opts: { sources: { name: string; releases: ReleaseStore }[] }) {
    this.sources = opts.sources;
  }

  get emptyReason(): string {
    const [only] = this.sources;

    return this.sources.length === 1
      ? only.releases.emptyReason
      : this.sources.map(source => `${source.name}: ${source.releases.emptyReason}`).join('; ');
  }

  isEmpty(): boolean {
    return this.sources.every(source => source.releases.isEmpty());
  }

  packages(): string[] {
    return [...new Set(this.sources.flatMap(source => source.releases.packages()))].sort(byText);
  }

  livePackages(): string[] {
    return [...new Set(this.sources.flatMap(source => source.releases.livePackages()))].sort(
      byText,
    );
  }

  entryDates(): string[] {
    return [...new Set(this.sources.flatMap(source => source.releases.entryDates()))]
      .sort(byText)
      .reverse();
  }

  packageOf(opts: { package: string }): string {
    return this.ownerOf(opts)?.releases.packageOf(opts) ?? opts.package;
  }

  versionsOf(opts: { package: string }): string[] {
    return this.ownerOf(opts)?.releases.versionsOf(opts) ?? [];
  }

  newestOf(opts: { package: string }): IReleaseRecord | undefined {
    return this.ownerOf(opts)?.releases.newestOf(opts);
  }

  releaseDateOf(opts: { package: string; version: string }): string | undefined {
    return this.ownerOf(opts)?.releases.releaseDateOf(opts);
  }

  releaseOrderOf(opts: { package: string; version: string }): number | undefined {
    return this.ownerOf(opts)?.releases.releaseOrderOf(opts);
  }

  entriesBetween(opts: { package?: string; fromDate: string; toDate: string }): IChangelogRecord[] {
    return this.tagged({ package: opts.package, read: store => store.entriesBetween(opts) });
  }

  entriesBetweenOrders(opts: {
    package?: string;
    fromOrder: number;
    toOrder: number;
    fromDate: string;
    toDate: string;
  }): IChangelogRecord[] {
    return this.tagged({ package: opts.package, read: store => store.entriesBetweenOrders(opts) });
  }

  /** The one source a package belongs to; with one source, that source, whatever it is asked. */
  private ownerOf(opts: { package: string }): { name: string; releases: ReleaseStore } | undefined {
    if (this.sources.length === 1) {
      return this.sources[0];
    }

    const owner = packageAcrossSources({
      value: opts.package,
      sources: this.sources.map(source => ({
        source: source.name,
        packageMap: source.releases.packageMapEntries(),
      })),
    });

    return this.sources.find(source => source.name === owner?.source);
  }

  /** A package's entries from its source; without a package, every source's, newest first. */
  private tagged(opts: {
    package?: string;
    read: (store: ReleaseStore) => IChangelogRecord[];
  }): IChangelogRecord[] {
    const sources =
      opts.package === undefined
        ? this.sources
        : [this.ownerOf({ package: opts.package })].filter(
            (source): source is { name: string; releases: ReleaseStore } => source !== undefined,
          );

    return sources
      .flatMap(source =>
        opts.read(source.releases).map(entry => ({ ...entry, source: source.name })),
      )
      .sort((left, right) => byText(right.date, left.date));
  }
}

/** One symbol store per source, served as one: every record names its source. */
export class SourceSymbols {
  private readonly sources: { name: string; symbols: SymbolStore }[];

  constructor(opts: { sources: { name: string; symbols: SymbolStore }[] }) {
    this.sources = opts.sources;
  }

  get emptyReason(): string {
    return this.sources.map(source => `${source.name}: ${source.symbols.emptyReason}`).join('; ');
  }

  isEmpty(): boolean {
    return this.sources.every(source => source.symbols.isEmpty());
  }

  lookup(opts: { name: string; package?: string }): ISymbolRecord[] {
    return this.sources.flatMap(source =>
      source.symbols.lookup(opts).map(record => ({ ...record, source: source.name })),
    );
  }

  suggest(opts: { name: string; limit?: number }): string[] {
    const names = [...new Set(this.sources.flatMap(source => source.symbols.suggest(opts)))];

    return opts.limit === undefined ? names : names.slice(0, opts.limit);
  }
}
