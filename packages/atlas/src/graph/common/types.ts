export interface IGraphNode {
  id: string;
  kind: string;
  name: string;
  /** From the project root; a package and a file have one. */
  path?: string;
  /** The npm name of the package that owns the node. */
  package?: string;
  /** A file's import specifiers that lead to no tracked TypeScript file (npm packages, node:, an alias not listed, a stylesheet, an excluded file): sorted, unique. */
  external?: string[];
  /** What a symbol node holds: its kind, the line it is declared on, a digest of its declaration (when the source has one), and whether it has TSDoc. No signature: `symbol` serves it. */
  symbol?: {
    kind: string;
    line: number;
    documented: boolean;
    shape?: string;
    /** The export re-exports a declaration that lives in `node_modules`. */
    thirdParty?: boolean;
  };
}

export interface IGraphEdge {
  from: string;
  to: string;
  kind: string;
}

/** What a producer returns: its own nodes and edges, sorted. */
export interface IGraphPart {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
}

export interface IGraphSource {
  /** The commit the graph was built at; undefined outside a git repository. */
  commit?: string;
  /** Tracked files of the scope had uncommitted changes. */
  dirty: boolean;
  /** The repository paths the graph was built from. */
  scope: string[];
}

export interface ICodeGraph extends IGraphPart {
  schemaVersion: number;
  kind: string;
  source: IGraphSource;
}

/** What a project may set for the graph (`graph` in its config, rendered into the manifest). */
export interface IGraphConfig {
  /** Globs of tracked files left out. */
  exclude: string[];
  /** An import prefix (`@/`) to a folder of the importing package (`src/`). */
  aliases: Record<string, string>;
}

/**
 * A producer reads one source and returns nodes and edges of the kinds it owns. Same input, same bytes: sorted, no network,
 * no clock. A new kind of node is a new producer; the file the graph is written to does not change shape.
 */
export interface IGraphProducer<TInput> {
  /** The node kinds it owns. */
  readonly kinds: readonly string[];
  produce(opts: TInput): IGraphPart;
}

/** What one file looked like at a build. */
export interface IFileFingerprint {
  /** The npm name of the package that owns it. */
  package: string;
  /** A hash of the bytes. */
  content: string;
  /** A hash of the skeleton of a source file; absent for a `package.json`. */
  surface?: string;
  /** A hash of the import specifiers of a source file; absent for a `package.json`. */
  imports?: string;
  /** A `package.json`: any change to it makes the next build read everything again. */
  manifest?: boolean;
}

/** `fingerprints.json`: the state the last build read, to compare with the next. */
export interface IFingerprints {
  schemaVersion: number;
  files: Record<string, IFileFingerprint>;
  /** For each package, a digest of its built declaration files (empty when it has none). */
  declarations: Record<string, string>;
  /** A hash of the packages and the `graph` block of the config. */
  inputs: string;
}

/** `meta.json`: when and from what the graph was built. */
export interface IGraphMeta {
  schemaVersion: number;
  builtAt: string;
  commit?: string;
  /** Tracked files of the scope had uncommitted changes at the build. */
  dirty: boolean;
  scope: string[];
  /** What the build did: skip, partial or full. */
  decision: string;
}

/** What `graph status` answers. */
export interface IGraphStatus {
  /** `fresh`, `behind`, `diverged` or `unknown`. */
  state: string;
  /** Files the graph was built from that differ now (new, changed or gone). */
  behind?: number;
  /** The first of them. */
  files?: string[];
  /** The commit the graph was built at, and HEAD now. */
  commit?: string;
  head?: string;
  builtAt?: string;
  /** Why `unknown`. */
  reason?: string;
}
