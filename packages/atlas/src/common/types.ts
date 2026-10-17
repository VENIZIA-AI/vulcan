import type { TConstValue } from '@venizia/ignis-helpers/common';
import type { AtlasModes, Corpora } from './constants';

export type TAtlasMode = TConstValue<typeof AtlasModes>;
export type TCorpus = TConstValue<typeof Corpora>;

/** The part of a package.json the generators read. */
export interface IPackageManifest {
  name: string;
  /** Conditions other than `types` (`import`, `require`, `default`...) are read by nobody here. */
  exports: Record<string, string | { types?: string; [condition: string]: unknown }>;
}

/** One `exports` subpath and the declaration file that types it. */
export interface IDeclarationEntry {
  subpath: string;
  types: string;
}

/** One package of a run: its manifest and the absolute declaration file of each typed entry. */
export interface IPackageEntries {
  name: string;
  manifest: IPackageManifest;
  entries: { subpath: string; file: string }[];
}
