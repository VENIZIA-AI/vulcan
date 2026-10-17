import type { IChunk } from '@/corpus';
import type { TCorpus } from '@/common';

/** One search result: a chunk ranked by `bm25()`, with a query-context snippet from its body. */
export interface IHit {
  /** The source it came from, when atlas serves more than one. */
  source?: string;
  id: string;
  corpus: TCorpus;
  title: string;
  headingPath: string;
  anchor: string;
  snippet: string;
  score: number;
}

/** The two FTS5 `MATCH` strings `QueryPlanner` builds from one query: all terms, then any term. */
export interface IQueryPlan {
  and: string;
  or: string;
  corpus?: TCorpus;
}

/** What the tools read from a search index - one source's store, or several served as one. */
export interface IChunkIndex {
  search(opts: { query: string; corpus?: TCorpus; limit: number; offset: number }): {
    total: number;
    hits: IHit[];
  };
  get(opts: { id: string; source?: string }): (IChunk & { source?: string }) | undefined;
  list(opts: { document: string; source?: string }): IChunk[];
}
