/**
 * The variables a guard process must not inherit: bun loads `BUN_OPTIONS=--preload=<file>` before the guard (the only name
 * proven to), and reads its options from the rest. The hooks reference says what is not covered; a test holds the extension's copy equal.
 */
export class LoaderEnvironment {
  /** Names taken out whole. */
  static readonly NAMES = ['BUN_OPTIONS', 'NODE_OPTIONS'];
  /** Every name that starts with one of these is taken out. */
  static readonly PREFIXES = ['BUN_CONFIG_', 'BUN_INSPECT'];

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
