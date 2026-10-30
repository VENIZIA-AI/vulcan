import type { IAtlasPreset } from '@/common/project-config';

// The registry of the presets VENIZIA publishes: data the `presets` tool answers with. It is the one
// file of VULCAN's source that names the frameworks, and the project-names gate exempts it by name.
export interface IOfficialPreset {
  id: string;
  side: IAtlasPreset['side'];
  summary: string;
  lib: string;
  /** The summary of the preset's shared kind; absent when the preset's package ships none. */
  shared?: string;
}

/**
 * The presets VENIZIA publishes, as the manifest of a project that never used them cannot say. A
 * recorded preset of the same package (`ignis`, `@venizia/ignis`, a pinned version) replaces its entry.
 */
export const OFFICIAL_PRESETS: IOfficialPreset[] = [
  {
    id: 'ignis',
    side: 'backend',
    summary: 'IGNIS: a backend app on Bun (official; not yet in this project)',
    lib: 'IGNIS: a library other apps import (official; not yet in this project)',
  },
  {
    id: 'ardor',
    side: 'frontend',
    summary: 'ARDOR: a frontend app on Vite and React (official; not yet in this project)',
    lib: 'ARDOR: a feature package other apps import (official; not yet in this project)',
  },
];

const OFFICIAL_SCOPE = '@venizia/';

/** `ignis` from `ignis`, `@venizia/ignis` or `ignis@0.3.5`: the name an official preset goes by. */
export const officialIdOf = (opts: { spec: string }): string =>
  opts.spec.replace(OFFICIAL_SCOPE, '').replace(/@.*$/, '');
