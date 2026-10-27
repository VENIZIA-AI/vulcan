import { Chunker, CorpusLoader, resolveRepositoryRoots } from '@/corpus';
import type { IAtlasProject } from '@/common/project-config';
import { ChunkStore } from '@/search/store';

/**
 * The search index of a project's declared roots, as bytes: what a pull stores for a commit and what
 * `atlas index` packs. One function builds both, so the two can never differ.
 */
export const indexBytesOf = (opts: { project: IAtlasProject }): Uint8Array => {
  const { project } = opts;
  const store = new ChunkStore();
  const documents = CorpusLoader.getInstance().load({
    roots: resolveRepositoryRoots({ project }),
    within: project.root,
  });
  const chunker = Chunker.getInstance();

  store.add({ chunks: documents.flatMap((document) => chunker.chunk({ document })) });

  const bytes = store.serialize();

  store.close();

  return bytes;
};
