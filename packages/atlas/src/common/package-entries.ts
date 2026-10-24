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
    .filter((entry) => DECLARATION_FILE.test(entry.types));

/** Any package directory - a project's own, an installed one, an unpacked tarball - and its typed entries. */
export const readPackageDirectory = (opts: {
  directory: string;
  name?: string;
}): IPackageEntries => {
  const manifest: IPackageManifest = JSON.parse(
    readFileSync(resolve(opts.directory, 'package.json'), 'utf8'),
  );
  const entries = declarationEntriesOf({ exports: manifest.exports ?? {} }).map((entry) => ({
    subpath: entry.subpath,
    file: resolve(opts.directory, entry.types),
  }));

  return { name: opts.name ?? manifest.name, manifest, entries };
};
