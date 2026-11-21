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

/** Where `vulcan x` finds a tool: the npm package and the bin it declares. */
export interface IToolPackage {
  packageName: string;
  binName: string;
}

export interface ICommandContext {
  args: string[];
  cwd: string;
}

/** Every command resolves to the process exit code; diagnostics go to stderr. */
export type TCommandHandler = (opts: ICommandContext) => Promise<number>;
