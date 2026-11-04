import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IDeclarationEntry, IPackageEntries, IPackageManifest } from './types';

const DECLARATION_FILE = /\.d\.[cm]?ts$/;
/** A TypeScript source file that is not a declaration file. */
const SOURCE_FILE = /(?<!\.d)\.[cm]?tsx?$/;
/** The conditions of an `exports` target a source entry may be written under, in the order they are tried. */
const SOURCE_CONDITIONS = ['types', 'import', 'default', 'bun'];

export class PackageEntries {
  /** The `exports` subpaths typed by a declaration file; css, json and plain js targets have no surface. */
  static declarationEntriesOf(opts: Pick<IPackageManifest, 'exports'>): IDeclarationEntry[] {
    return Object.entries(opts.exports)
      .map(([subpath, target]) => ({
        subpath,
        types: typeof target === 'string' ? target : (target.types ?? ''),
      }))
      .filter((entry) => DECLARATION_FILE.test(entry.types));
  }

  /** The `exports` subpaths of a package that publishes its TypeScript source: the entries a `.d.ts` does not type. */
  static sourceEntriesOf(opts: Pick<IPackageManifest, 'exports'>): IDeclarationEntry[] {
    return Object.entries(opts.exports).flatMap(([subpath, target]) => {
      const candidates =
        typeof target === 'string'
          ? [target]
          : SOURCE_CONDITIONS.map((condition) => target[condition]);
      const file = candidates.find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && SOURCE_FILE.test(candidate),
      );

      return file === undefined ? [] : [{ subpath, types: file }];
    });
  }

  /** Any package directory - a project's own, an installed one, an unpacked tarball - and its typed entries. */
  static readDirectory(opts: {
    directory: string;
    name?: string;
    /** Also the entries that point at a TypeScript source file; only a reader that needs no declaration text asks. */
    withSource?: boolean;
  }): IPackageEntries {
    const manifest: IPackageManifest = JSON.parse(
      readFileSync(resolve(opts.directory, 'package.json'), 'utf8'),
    );
    const exports = { exports: manifest.exports ?? {} };
    const typed = PackageEntries.declarationEntriesOf(exports);
    const sources =
      opts.withSource === true
        ? PackageEntries.sourceEntriesOf(exports).filter(
            (entry) => !typed.some((item) => item.subpath === entry.subpath),
          )
        : [];
    const entries = [...typed, ...sources].map((entry) => ({
      subpath: entry.subpath,
      file: resolve(opts.directory, entry.types),
    }));

    return { name: opts.name ?? manifest.name, manifest, entries };
  }
}
