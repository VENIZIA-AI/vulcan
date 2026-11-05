/** Where the graph files go, from the project root: local and gitignored with `.agents/local/`. */
export class GraphFiles {
  static readonly DIRECTORY = '.agents/local/graph';
  static readonly CODE = 'code.json';
  static readonly FINGERPRINTS = 'fingerprints.json';
  static readonly META = 'meta.json';
}

/** The node kinds of the code graph; the id of a node is its kind prefix and a name. */
export class GraphNodeKinds {
  static readonly PACKAGE = 'package';
  static readonly ENTRY = 'entry';
  static readonly FILE = 'file';
  static readonly SYMBOL = 'symbol';
}

export class GraphIdPrefixes {
  static readonly PACKAGE = 'pkg:';
  static readonly ENTRY = 'entry:';
  static readonly FILE = 'file:';
  static readonly SYMBOL = 'sym:';
}

export class GraphEdgeKinds {
  /** Package to entry, entry to its source file, file to the symbols declared in it. */
  static readonly CONTAINS = 'contains';
  /** Entry to the symbols it exports. */
  static readonly EXPORTS = 'exports';
  /** Symbol to the exported symbols its declaration refers to. */
  static readonly USES = 'uses';
  /** Package to package, from `dependencies` and `peerDependencies`. */
  static readonly DEPENDS = 'depends';
  /** File to file, or file to the entry of a workspace package it imports. */
  static readonly IMPORTS = 'imports';
  /** A file to the test file that imports it. */
  static readonly TESTED_BY = 'tested_by';
}

/** How much a file changed between two builds. */
export class GraphLevels {
  static readonly NONE = 'none';
  /** The bytes differ, the skeleton (tokens without comments, whitespace and function bodies) and the imports do not. */
  static readonly COSMETIC = 'cosmetic';
  /** The skeleton or the imports differ, or the file is new or gone. */
  static readonly STRUCTURAL = 'structural';
}

/** What a build does. */
export class GraphDecisions {
  static readonly SKIP = 'skip';
  static readonly PARTIAL = 'partial';
  static readonly FULL = 'full';
}

/** How a graph compares with the files it was built from. */
export class GraphStates {
  static readonly FRESH = 'fresh';
  static readonly BEHIND = 'behind';
  static readonly DIVERGED = 'diverged';
  static readonly UNKNOWN = 'unknown';
}

export class GraphConstants {
  /** More structural files than this, or more than `FULL_SHARE` of all files, and a build reads everything again. */
  static readonly PARTIAL_MAX_STRUCTURAL = 30;
  static readonly FULL_SHARE = 0.5;
  /** Characters kept of a sha-256: enough to tell two states of a file apart. */
  static readonly HASH_LENGTH = 16;
  /** How many changed files `status` names. */
  static readonly STATUS_FILES_SHOWN = 5;
  static readonly SCHEMA_VERSION = 1;
  /** Raised when a change of the producers changes what a graph holds, so a graph built before it is read again whole. */
  static readonly PRODUCER_VERSION = 1;
  /** What `inputs` is set to when a build could not read the symbols: the next build starts again. */
  static readonly INCOMPLETE = 'incomplete';
  /** What `code.json` should stay under on a large framework (about 1800 files and 3300 exported symbols). A target: the command says so when it is passed. */
  static readonly SIZE_TARGET_BYTES = 4 * 1024 * 1024;
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
  /** A test file, by name: `x.test.ts`, `x.spec.tsx`. A helper that sits beside the tests is not one. */
  static readonly TEST_PATTERN = /\.(test|spec)\.[cm]?tsx?$/;
  /** What a build puts the source under, when a package's `exports` names the built declaration. */
  static readonly BUILD_FOLDERS = ['dist/', 'build/', 'lib/'];
  /** Folders inside the build folder that the source does not have. */
  static readonly BUILD_SUBFOLDERS = ['esm/', 'cjs/', 'types/', ''];
  static readonly DECLARATION_ENDING = /\.d\.[cm]?ts$/;
}
