import { Corpora } from '@/common';
import type { IAtlasProject } from '@/common/project-config';
import { relative } from 'node:path';
import type { ICorpusRoot } from './common';

/**
 * A project's corpus roots, from its manifest: the knowledge bundle always, the wiki and the
 * changelogs when declared. A changelog directory inside the wiki is carved out of the wiki's root,
 * and `knowledge-tools` out of the bundle's.
 */
export const resolveRepositoryRoots = (opts: { project: IAtlasProject }): ICorpusRoot[] => {
  const { bundle, wiki, changelogs } = opts.project.knowledge;
  const nested =
    wiki !== undefined && changelogs !== undefined && changelogs.startsWith(`${wiki}/`)
      ? [relative(wiki, changelogs)]
      : [];

  const wikiRoots: ICorpusRoot[] =
    wiki === undefined ? [] : [{ corpus: Corpora.WIKI, directory: wiki, exclude: nested }];
  const changelogRoots: ICorpusRoot[] =
    changelogs === undefined ? [] : [{ corpus: Corpora.CHANGELOG, directory: changelogs }];

  return [
    ...wikiRoots,
    ...changelogRoots,
    { corpus: Corpora.KNOWLEDGE, directory: bundle, exclude: ['knowledge-tools'] },
  ];
};
