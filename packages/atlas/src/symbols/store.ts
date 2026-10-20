import { BaseHelper } from '@/common/helper';
import { packageOfQuery } from '@/common/package-map';
import type { IPackageMapEntry } from '@/common/package-map';
import type { ISymbolRecord } from './common';

const DEFAULT_SUGGESTION_LIMIT = 5;
const MAX_SUGGESTION_DISTANCE = 2;

/**
 * Levenshtein distance over two rows, abandoned once every cell of a row exceeds `max` - a typo
 * is compared against every known name, so the common case must stop early, not finish.
 */
const distanceWithin = (opts: { left: string; right: string; max: number }): number => {
  const { left, right, max } = opts;

  if (Math.abs(left.length - right.length) > max) {
    return max + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = row;

    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      const cell = Math.min(substitution, previous[column] + 1, current[column - 1] + 1);

      current.push(cell);
      best = Math.min(best, cell);
    }

    if (best > max) {
      return max + 1;
    }

    previous = current;
  }

  return previous[right.length];
};

/** Keeps the first occurrence of every value, in order - the buckets below overlap by design. */
const dedupe = (values: string[]): string[] => [...new Set(values)];

const byName = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

/**
 * The generated symbol table in memory: exact lookup by name, and a suggestion list for a name
 * that is not in it. One instance per server; a loaded table never changes while the process runs.
 */
export class SymbolStore extends BaseHelper {
  private readonly byExactName = new Map<string, ISymbolRecord[]>();
  private readonly namesByLowerCase = new Map<string, string[]>();

  private packageMap: IPackageMapEntry[];
  /** Every load error already logged: an unbuilt package fails each reload the same way. */
  private readonly loggedErrors = new Set<string>();
  private readonly loader?: () => { symbols: ISymbolRecord[]; packageMap?: IPackageMapEntry[] };
  /** What the loaded symbols were read from; when it moves, they are read again. */
  private readonly fingerprint?: () => string;
  private loadedFingerprint?: string;
  /** What the `symbol` tool says when the store holds nothing. */
  readonly emptyReason: string;

  /**
   * `symbols` now, or `load` on the first question - reading declarations takes the compiler, and a
   * server that waited for it at start would start slow. While `load` finds nothing, every question
   * loads again: packages built after the server started are read on the next one.
   */
  constructor(opts: {
    symbols?: ISymbolRecord[];
    packageMap?: IPackageMapEntry[];
    load?: () => { symbols: ISymbolRecord[]; packageMap?: IPackageMapEntry[] };
    /** Read before each question; a new value loads again (D2: repo mode follows the dist). */
    fingerprint?: () => string;
    emptyReason?: string;
  }) {
    super({ scope: SymbolStore.name });

    this.packageMap = opts.packageMap ?? [];
    this.loader = opts.load;
    this.fingerprint = opts.fingerprint;
    this.emptyReason = opts.emptyReason ?? 'no symbol table in this build';
    this.index({ symbols: opts.symbols ?? [] });
  }

  private ensureLoaded(): void {
    const loader = this.loader;

    if (loader === undefined) {
      return;
    }

    const fingerprint = this.fingerprint?.();

    if (this.byExactName.size > 0 && fingerprint === this.loadedFingerprint) {
      return;
    }

    try {
      const loaded = loader();

      this.byExactName.clear();
      this.namesByLowerCase.clear();
      this.packageMap = loaded.packageMap ?? this.packageMap;
      this.index({ symbols: loaded.symbols });
      this.loadedFingerprint = fingerprint;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.loggedErrors.has(message)) {
        this.loggedErrors.add(message);
        this.logger.for('load').error('could not read the declarations | error: %s', message);
      }
    }
  }

  private index(opts: { symbols: ISymbolRecord[] }): void {
    for (const symbol of opts.symbols) {
      const exact = this.byExactName.get(symbol.name) ?? [];

      exact.push(symbol);
      this.byExactName.set(symbol.name, exact);

      const lower = symbol.name.toLowerCase();
      const names = this.namesByLowerCase.get(lower) ?? [];

      if (!names.includes(symbol.name)) {
        names.push(symbol.name);
        this.namesByLowerCase.set(lower, names);
      }
    }
  }

  /** Whether no table was loaded at all - distinct from a table that simply does not carry a name. */
  isEmpty(): boolean {
    this.ensureLoaded();

    return this.byExactName.size === 0;
  }

  /** Every exact-name match, narrowed by `package` when given; a name can exist in more than one package. */
  lookup(opts: { name: string; package?: string }): ISymbolRecord[] {
    this.ensureLoaded();

    const found = this.byExactName.get(opts.name) ?? [];

    if (opts.package === undefined) {
      return found;
    }

    const packageMap = this.packageMap;
    const wanted = packageOfQuery({ value: opts.package, packageMap });

    return found.filter(record => packageOfQuery({ value: record.package, packageMap }) === wanted);
  }

  /** The closest known names to `name`: prefix matches first, then substrings, then near-misses. */
  suggest(opts: { name: string; limit?: number }): string[] {
    this.ensureLoaded();

    const limit = opts.limit ?? DEFAULT_SUGGESTION_LIMIT;
    const wanted = opts.name.toLowerCase();
    const lowerNames = [...this.namesByLowerCase.keys()];

    const prefixed = lowerNames.filter(name => name.startsWith(wanted)).sort(byName);
    const contained = lowerNames.filter(name => name.includes(wanted)).sort(byName);
    const near = lowerNames
      .map(name => ({
        name,
        distance: distanceWithin({ left: wanted, right: name, max: MAX_SUGGESTION_DISTANCE }),
      }))
      .filter(entry => entry.distance <= MAX_SUGGESTION_DISTANCE)
      .sort((left, right) => left.distance - right.distance || byName(left.name, right.name))
      .map(entry => entry.name);

    const ordered = dedupe([...prefixed, ...contained, ...near]).flatMap(
      lower => this.namesByLowerCase.get(lower) ?? [],
    );

    return ordered.slice(0, limit);
  }
}
