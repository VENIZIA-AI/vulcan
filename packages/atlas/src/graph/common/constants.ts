/** Where the graph files go, from the project root: local and gitignored with `.agents/local/`. */
export class GraphFiles {
  static readonly DIRECTORY = '.agents/local/graph';
  static readonly CODE = 'code.json';
}

/** The node kinds of the code graph; the id of a node is its kind prefix and a name. */
export class GraphNodeKinds {
  static readonly PACKAGE = 'package';
  static readonly ENTRY = 'entry';
  static readonly FILE = 'file';
}

export class GraphIdPrefixes {
  static readonly PACKAGE = 'pkg:';
  static readonly ENTRY = 'entry:';
  static readonly FILE = 'file:';
}

export class GraphEdgeKinds {
  /** Package to entry, entry to its source file. */
  static readonly CONTAINS = 'contains';
  /** Package to package, from `dependencies` and `peerDependencies`. */
  static readonly DEPENDS = 'depends';
  /** File to file, or file to the entry of a workspace package it imports. */
  static readonly IMPORTS = 'imports';
  /** A file to the test file that imports it. */
  static readonly TESTED_BY = 'tested_by';
}

export class GraphConstants {
  static readonly SCHEMA_VERSION = 1;
  static readonly KIND_CODE = 'code';
  /** The tracked files read: TypeScript and its module variants. */
  static readonly SOURCE_PATTERN = /\.[cm]?tsx?$/;
  /** The endings an import specifier may carry for a file the source spells with a TypeScript ending. */
  static readonly JS_ENDINGS = new Map<string, string[]>([
    ['.js', ['.ts', '.tsx']],
    ['.mjs', ['.mts']],
    ['.cjs', ['.cts']],
    ['.jsx', ['.tsx']],
  ]);
  /** Tried after a bare path, in order. */
  static readonly EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts'];
  /** A file that tests another: by folder, or by name. */
  static readonly TEST_PATTERN = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?tsx?$/;
}
