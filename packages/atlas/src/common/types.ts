import type {
  AppSides,
  Corpora,
  LibraryTypes,
  LogLevels,
  PackageTypes,
  SkillSources,
  SourcePins,
} from './constants';

/** The values of a const class's static fields: `TConstValue<typeof Colors>` is `'red' | 'blue'`. */
export type TConstValue<TClass> = Extract<TClass[keyof TClass], string | number> & {};

/**
 * The base of a const class that validates values: `class Colors extends ConstClass { static readonly RED = 'red'; }`.
 * `values()` is the string statics of the subclass, in declaration order, and `isValid` is the runtime check
 * that `TConstValue<typeof Colors>` is the type of. A class whose statics are numbers does not extend it.
 */
export class ConstClass {
  static readonly #cache = new WeakMap<object, readonly string[]>();

  /** The string statics of the subclass, once each; throws when it has none. */
  static values<T extends typeof ConstClass>(
    this: T,
  ): readonly [TConstValue<T>, ...TConstValue<T>[]] {
    const found = ConstClass.#cache.get(this) ?? [
      ...new Set(Object.values(this).filter((value) => typeof value === 'string')),
    ];

    if (found.length === 0) {
      throw new Error(`${this.name} has no values`);
    }

    ConstClass.#cache.set(this, found);

    // `this` is a subclass, so its string statics are the values of `TConstValue<T>`; the compiler cannot see that.
    return found as readonly [TConstValue<T>, ...TConstValue<T>[]];
  }

  /** Whether `value` is one of the string statics of the subclass. */
  static isValid<T extends typeof ConstClass>(this: T, value: unknown): value is TConstValue<T> {
    return typeof value === 'string' && this.values().some((candidate) => candidate === value);
  }
}

export type TCorpus = TConstValue<typeof Corpora>;
export type TLogLevel = TConstValue<typeof LogLevels>;
export type TSkillSource = TConstValue<typeof SkillSources>;
export type TPackageType = TConstValue<typeof PackageTypes>;
export type TLibraryType = TConstValue<typeof LibraryTypes>;
export type TAppSide = TConstValue<typeof AppSides>;
export type TSourcePin = TConstValue<typeof SourcePins>;

/** A scoped logger; `for` narrows the scope to one method. Every line goes to stderr. */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  emerg(message: string, ...args: unknown[]): void;
  log(level: TLogLevel, message: string, ...args: unknown[]): void;
  for(methodName: string): ILogger;
}

/** The part of a package.json the generators read. */
export interface IPackageManifest {
  name: string;
  /** Conditions other than `types` (`import`, `require`, `default`...) are read by nobody here. */
  exports: Record<string, string | { types?: string; [condition: string]: unknown }>;
}

/** One `exports` subpath and the declaration file that types it. */
export interface IDeclarationEntry {
  subpath: string;
  types: string;
}

/** One package of a run: its manifest and the absolute declaration file of each typed entry. */
export interface IPackageEntries {
  name: string;
  manifest: IPackageManifest;
  entries: { subpath: string; file: string }[];
}
