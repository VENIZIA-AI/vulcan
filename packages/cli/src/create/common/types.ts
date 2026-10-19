import type { TConstValue } from '../../common/index.ts';
import type { AppSides } from './constants.ts';

export type TAppSide = TConstValue<typeof AppSides>;

/** One name init or add needs: the flag that carries it, the question that asks it. */
export interface INameField {
  key: string;
  flag: string;
  question: string;
  /** Only the shared folder may be left empty. */
  optional?: boolean;
  /** A folder the user chose before, offered as the answer; never a name VULCAN made up. */
  previous?: string;
}

export type TAsk = (opts: { question: string; previous?: string }) => string | null;

export type TNamesResult =
  | { ok: true; names: Record<string, string> }
  | { ok: false; error: string };

export interface IPresetAtlasSource {
  name: string;
  repo: string;
  ref: string;
}

export interface IPreset {
  presetVersion: number;
  side: TAppSide;
  summary: string;
  devPort: number;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Peer ranges the monorepo's existing catalog must satisfy (a framework's range on its base). */
  peers: Record<string, string>;
  scripts: Record<string, string>;
  checks: string[];
  /** The folder holding the files to copy, absolute once the preset is located. */
  files: string;
  atlas: IPresetAtlasSource[];
}

export interface IPresetSpec {
  /** The npm name, or undefined for a `file:` path. */
  packageName?: string;
  /** What goes after the name in a dependency: a version, a tag, or `file:<abs path>`. */
  range: string;
}

export interface ILocatedPreset {
  preset: IPreset;
  /** The preset package's root directory. */
  packageRoot: string;
  packageName: string;
  packageVersion: string;
}

export type TPresetResult = { ok: true; located: ILocatedPreset } | { ok: false; error: string };

export interface IApp {
  name: string;
  side: TAppSide;
  folder: string;
}

/** What `init` and `add` own in the config: the layout, the package list and the atlas sources. */
export interface IAppsBlock {
  layout: { backend?: string; frontend?: string; shared?: string };
  packages: { dir: string; name: string; path: string }[];
  sources: { name: string; repo: string; ref: string }[];
}
