import type { IPackageMapEntry } from '@/common/package-map';

/**
 * One exported symbol as `scripts/atlas-symbols.ts` recorded it. `file`/`line` name the source
 * declaration, not the `dist` file the generator read - an alias export points at what it aliases.
 */
export interface ISymbolRecord {
  /** The source it came from, when atlas serves more than one. */
  source?: string;
  name: string;
  package: string;
  subpath: string;
  specifier: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
}

/** What `search` adds beside its hits when the query is one identifier the table knows - no signature, no docs, so the reply budget barely moves. */
export interface ISymbolBrief {
  name: string;
  package: string;
  specifier: string;
  kind: string;
  file: string;
  line: number;
}

/** The generated `symbols.json` payload, whole. */
export interface ISymbolTable {
  generatedFrom: string;
  packages: string[];
  symbols: ISymbolRecord[];
  /** Every package's directory, npm name and other names; absent in a table generated before 0.2.0-0. */
  packageMap?: IPackageMapEntry[];
}

/** What the tools read from symbol tables - one source's store, or several served as one. */
export interface ISymbolIndex {
  readonly emptyReason: string;
  isEmpty(): boolean;
  lookup(opts: { name: string; package?: string }): ISymbolRecord[];
  suggest(opts: { name: string; limit?: number }): string[];
}
