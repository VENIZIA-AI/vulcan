import type { IPackageMapEntry } from '@/common/package-map';

/**
 * One exported symbol as `vulcan x atlas symbols` records it. `file`/`line` name the source
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
  /**
   * A digest of the whole declaration - members, parameters, no comments, no layout - read from the
   * built `.d.ts`. Never served.
   */
  shape?: string;
  /** Present and true when `file` points inside `node_modules`: the export re-exports a third-party declaration, so the path is an install detail, not repository source. */
  external?: boolean;
  /** The declaration as the built `.d.ts` has it: its TSDoc, its members, the unexported declarations it uses. Capped. */
  declaration?: string;
  /** The TSDoc of the export alone, without comment markers; empty when there is none. */
  doc?: string;
  /** Names of exported symbols the declaration refers to. */
  uses?: string[];
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
  /** Every package's directory, npm name and other names. */
  packageMap: IPackageMapEntry[];
}

/** What the tools read from symbol tables - one source's store, or several served as one. */
export interface ISymbolIndex {
  readonly emptyReason: string;
  isEmpty(): boolean;
  lookup(opts: { name: string; package?: string }): ISymbolRecord[];
  suggest(opts: { name: string; limit?: number }): string[];
}
