import type { ILayout } from '../../common/layout-folder.ts';
import type { TConstValue } from '../../common/index.ts';
import type { TLibraryKind } from '../../config/common/index.ts';
import type { AppSides, AppsBlockProblems } from './constants.ts';

export type TAppSide = TConstValue<typeof AppSides>;
export type TAppsBlockProblem = TConstValue<typeof AppsBlockProblems>;

/** One name init or add needs: the flag that carries it, the question that asks it. */
export interface INameField {
  key: string;
  flag: string;
  question: string;
  /** Only the shared folder may be left empty. */
  optional?: boolean;
  /** A folder the user chose before, offered as the answer; never a name VULCAN made up. */
  previous?: string;
  /** Folders that already exist and fit this field: a menu lists them, then offers a new one. */
  choices?: string[];
  /** The only valid answer is `previous` (one folder per side): a menu never asks, a flag still wins. */
  fixed?: boolean;
  /** The value is a folder path (1 to 4 segments) and not a single name. */
  isPath?: boolean;
}

/** What a question carries: the text, the earlier choice, the existing folders, the check a menu runs while typing. */
export interface IAskOptions {
  question: string;
  previous?: string;
  choices?: string[];
  /** The message to show, or nothing when the text is fine. */
  validate?: (value: string) => string | undefined;
}

/** `null` is end of input or a cancelled menu; a menu answers later, so the answer may be a promise. */
export type TAsk = (opts: IAskOptions) => string | null | Promise<string | null>;

/** Reads at most one byte into `buffer` and returns how many were read; 0 is end of input. */
export type TByteReader = (opts: { descriptor: number; buffer: Buffer }) => number;

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
  /** Paths under the dev port worth opening (`/api/hello`); none means the root. */
  urls: string[];
  /** The app's `package.json` `imports` (Node subpath imports), copied as they are written. */
  imports: Record<string, string>;
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
  /** The lib preset file (`vulcan.presets.lib`), absolute and inside the package; absent when the preset makes apps only. */
  libFile?: string;
  /** The shared preset file (`vulcan.presets.shared`), absolute and inside the package; absent when the preset has no shared kind. */
  sharedFile?: string;
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

/**
 * A preset an app of this project came from, as `--preset` takes it back: so an agent that is asked
 * for a new app finds the exact command. Apps only today; a preset has no kind and is an app.
 */
export interface IRecordedPreset {
  spec: string;
  side: TAppSide;
  summary: string;
  /** The summary of the preset's lib kind; present when the preset can make a library. */
  lib?: string;
  /** The summary of the preset's shared kind; present when the preset can make a shared package. */
  shared?: string;
}

/** What `init` and `add` own in the config: the layout, the package list, the presets and the atlas sources. */
export interface IAppsBlock {
  layout: ILayout;
  packages: { dir: string; name: string; path: string; kind?: 'lib'; presetKind?: TLibraryKind }[];
  /** Absent in a block written before presets were recorded. */
  presets?: IRecordedPreset[];
  sources: { name: string; repo: string; ref: string }[];
}
