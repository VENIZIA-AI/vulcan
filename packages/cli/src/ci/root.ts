import { RecordValue } from '../common/record.ts';
import { CiConstants } from './common/index.ts';
import type { ICatalogEntry, IDependency, TRootChange } from './common/index.ts';

type TCatalogs = Record<string, Record<string, string>>;

/** What a change to the root `package.json` means: everything, only the users of some catalog entries, or nothing. */
export class CiRootManifest {
  /**
   * Compares the two texts. When the only difference is inside the catalogs (`catalog` and `catalogs`, at
   * the top or in `workspaces`), the answer is the entries whose version changed, added or removed; any
   * other difference, a file added or removed, or text that is not JSON, is everything.
   */
  static compare(opts: { before: string | undefined; after: string | undefined }): TRootChange {
    if (opts.before === undefined || opts.after === undefined) {
      return { kind: 'all', because: `${CiConstants.ROOT_MANIFEST} was added or removed` };
    }

    let before: unknown;
    let after: unknown;

    try {
      before = JSON.parse(opts.before);
      after = JSON.parse(opts.after);
    } catch {
      return { kind: 'all', because: `${CiConstants.ROOT_MANIFEST} cannot be read` };
    }

    if (!RecordValue.isRecord(before) || !RecordValue.isRecord(after)) {
      return { kind: 'all', because: `${CiConstants.ROOT_MANIFEST} cannot be read` };
    }

    if (
      CiRootManifest.canonical({ value: CiRootManifest.withoutCatalogs({ manifest: before }) }) !==
      CiRootManifest.canonical({ value: CiRootManifest.withoutCatalogs({ manifest: after }) })
    ) {
      return { kind: 'all', because: `${CiConstants.ROOT_MANIFEST} changed outside its catalogs` };
    }

    const entries = CiRootManifest.changedEntries({
      before: CiRootManifest.catalogsOf({ manifest: before }),
      after: CiRootManifest.catalogsOf({ manifest: after }),
    });

    return entries.length === 0 ? { kind: 'none' } : { kind: 'catalog', entries };
  }

  /** Whether `dependency` is taken from the catalog entry: `catalog:` is the unnamed one, `catalog:name` a named one. */
  static usesEntry(opts: { dependency: IDependency; entry: ICatalogEntry }): boolean {
    const { dependency, entry } = opts;

    if (dependency.name !== entry.name || !dependency.spec.startsWith(CiConstants.CATALOG_PREFIX)) {
      return false;
    }

    const named = dependency.spec.slice(CiConstants.CATALOG_PREFIX.length);

    return (named === '' ? CiConstants.DEFAULT_CATALOG : named) === entry.catalog;
  }

  private static withoutCatalogs(opts: {
    manifest: Record<string, unknown>;
  }): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...opts.manifest };

    for (const key of CiConstants.CATALOG_KEYS) {
      delete copy[key];
    }

    if (RecordValue.isRecord(copy.workspaces)) {
      const workspaces: Record<string, unknown> = { ...copy.workspaces };

      for (const key of CiConstants.CATALOG_KEYS) {
        delete workspaces[key];
      }

      copy.workspaces = workspaces;
    }

    return copy;
  }

  /** The catalogs by name, from both places bun reads them; `default` is the unnamed one. */
  private static catalogsOf(opts: { manifest: Record<string, unknown> }): TCatalogs {
    const found: TCatalogs = {};
    const places = [
      opts.manifest,
      RecordValue.isRecord(opts.manifest.workspaces) ? opts.manifest.workspaces : {},
    ];

    for (const place of places) {
      if (RecordValue.isRecord(place.catalog)) {
        found[CiConstants.DEFAULT_CATALOG] = {
          ...found[CiConstants.DEFAULT_CATALOG],
          ...CiRootManifest.versionsOf({ value: place.catalog }),
        };
      }

      if (RecordValue.isRecord(place.catalogs)) {
        for (const [name, entries] of Object.entries(place.catalogs)) {
          found[name] = { ...found[name], ...CiRootManifest.versionsOf({ value: entries }) };
        }
      }
    }

    return found;
  }

  private static versionsOf(opts: { value: unknown }): Record<string, string> {
    return RecordValue.isRecord(opts.value)
      ? Object.fromEntries(
          Object.entries(opts.value).map(([name, version]) => [name, JSON.stringify(version)]),
        )
      : {};
  }

  private static changedEntries(opts: { before: TCatalogs; after: TCatalogs }): ICatalogEntry[] {
    const entries: ICatalogEntry[] = [];

    for (const catalog of new Set([...Object.keys(opts.before), ...Object.keys(opts.after)])) {
      const was = opts.before[catalog] ?? {};
      const now = opts.after[catalog] ?? {};

      for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if (was[name] !== now[name]) {
          entries.push({ catalog, name });
        }
      }
    }

    return entries;
  }

  /** JSON with the keys in order, so two texts that mean the same compare equal. */
  private static canonical(opts: { value: unknown }): string {
    const { value } = opts;

    if (Array.isArray(value)) {
      return `[${value.map((item) => CiRootManifest.canonical({ value: item })).join(',')}]`;
    }

    if (RecordValue.isRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${CiRootManifest.canonical({ value: value[key] })}`)
        .join(',')}}`;
    }

    return JSON.stringify(value) ?? 'null';
  }
}
