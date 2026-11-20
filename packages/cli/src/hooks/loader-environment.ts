/**
 * The environment variables a guard process must not inherit. `bun --no-env-file --config=/dev/null` keeps a `.env`
 * and a `bunfig.toml` out of a guard, but `BUN_OPTIONS=--preload=<file>` still runs the file before the guard does
 * (measured on bun 1.4.4; it is the only name proven to). `NODE_OPTIONS` and `BUN_CONFIG_*` had no effect there; they
 * are stripped as a precaution, because bun reads its configuration from them. `PATH`, `NODE_PATH` and the other
 * loader variables are not covered.
 *
 * The hook scripts under `base/hooks` import nothing from the package, so the extension for omp and pi
 * (`base/extensions/vulcan-guards.ts`) keeps its own copy of these names; a test holds the copy equal.
 */
export class LoaderEnvironment {
  /** Names taken out whole. */
  static readonly NAMES = ['BUN_OPTIONS', 'NODE_OPTIONS'];
  /** Every name that starts with one of these is taken out. */
  static readonly PREFIXES = ['BUN_CONFIG_'];

  static isStripped(name: string): boolean {
    return (
      LoaderEnvironment.NAMES.includes(name) ||
      LoaderEnvironment.PREFIXES.some((prefix) => name.startsWith(prefix))
    );
  }

  /** A copy of `env` without the stripped names. */
  static without(env: Record<string, string | undefined>): Record<string, string | undefined> {
    return Object.fromEntries(
      Object.entries(env).filter(([name]) => !LoaderEnvironment.isStripped(name)),
    );
  }

  /**
   * POSIX sh that unsets the stripped names in the hook's own shell, so everything the entry starts (the guard, the
   * `bun -e` manifest check) inherits an environment without them. `env -u` takes no pattern, so a prefix is
   * found by reading the names `env` prints.
   */
  static shellUnset(): string {
    const prefixes = LoaderEnvironment.PREFIXES.map((prefix) => `${prefix}[A-Za-z0-9_]*`).join(
      '\\|',
    );

    return `unset ${LoaderEnvironment.NAMES.join(' ')}; for n in $(env | sed -n 's/^\\(${prefixes}\\)=.*/\\1/p'); do unset "$n"; done;`;
  }
}
