export interface IOkfPackage {
  dir: string;
  name: string;
  /** Absolute; `packages/<dir>` under the root unless the config says otherwise. */
  path: string;
  retired: boolean;
}

/** One `okf.renderers` entry: a built-in id, or a project module, with its options. */
export interface IOkfRendererEntry {
  id: string;
  module?: string;
  options: Record<string, unknown>;
}

/** One `okf.regions` entry; `file` is absolute (resolved under the bundle). */
export interface IOkfRegionEntry {
  id: string;
  file: string;
  renderer: string;
}

export interface IOkfProject {
  root: string;
  bundle: string;
  packages: IOkfPackage[];
  renderers: IOkfRendererEntry[];
  regions: IOkfRegionEntry[];
  sections: { order: string[]; labels: Record<string, string> };
  coverage: { name: string; path: string }[];
  denylist: Set<string>;
  viz: { outputs: string[]; brand: string; copy?: Record<string, unknown> };
}
