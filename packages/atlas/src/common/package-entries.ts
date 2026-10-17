import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IDeclarationEntry, IPackageEntries, IPackageManifest } from './types';

const DECLARATION_FILE = /\.d\.[cm]?ts$/;

/** The `exports` subpaths typed by a declaration file; css, json and plain js targets have no surface. */
export const declarationEntriesOf = (
  opts: Pick<IPackageManifest, 'exports'>,
): IDeclarationEntry[] =>
  Object.entries(opts.exports)
    .map(([subpath, target]) => ({
      subpath,
      types: typeof target === 'string' ? target : (target.types ?? ''),
    }))
    .filter(entry => DECLARATION_FILE.test(entry.types));

/** `packages/<name>/package.json` and its typed entries, resolved to absolute files. */
export const readPackageEntries = (opts: { repoRoot: string; name: string }): IPackageEntries => {
  const directory = resolve(opts.repoRoot, 'packages', opts.name);
  const manifest: IPackageManifest = JSON.parse(
    readFileSync(resolve(directory, 'package.json'), 'utf8'),
  );
  const entries = declarationEntriesOf({ exports: manifest.exports }).map(entry => ({
    subpath: entry.subpath,
    file: resolve(directory, entry.types),
  }));

  return { name: opts.name, manifest, entries };
};
