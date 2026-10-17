import { join } from 'node:path';
import { AtlasModes } from './constants';
import type { TAtlasMode } from './types';

/** The packaged corpus's directory name inside a package's `dist` tree - always joined onto that tree, never onto a bare package directory. */
export const SNAPSHOT_DIRECTORY = 'corpus';

/** The generated symbol table's file name, the same in both modes - only the directory differs. */
export const SYMBOLS_FILE = 'symbols.json';

/** The generated release table's file name, the same in both modes - only the directory differs. */
export const RELEASES_FILE = 'releases.json';

/** Where a generated table lives: the bundle's `reference/` in repo mode, the packaged corpus in snapshot mode. */
const tableFileOf = (opts: {
  mode: TAtlasMode;
  root: string;
  bundle?: string;
  file: string;
}): string =>
  opts.mode === AtlasModes.REPOSITORY
    ? join(opts.bundle ?? join(opts.root, '.agents/knowledge'), 'reference', opts.file)
    : join(opts.root, SNAPSHOT_DIRECTORY, opts.file);

export const symbolsFileOf = (opts: { mode: TAtlasMode; root: string; bundle?: string }): string =>
  tableFileOf({ ...opts, file: SYMBOLS_FILE });

export const releasesFileOf = (opts: { mode: TAtlasMode; root: string; bundle?: string }): string =>
  tableFileOf({ ...opts, file: RELEASES_FILE });
