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
