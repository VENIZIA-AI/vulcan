/** The lock `concepts stamp` writes beside the concepts, inside the knowledge bundle. */
export const SYMBOLS_LOCK_NAME = '.symbols.lock.json';

/** Why `concepts check` sends a concept back for review. */
export class ConceptProblems {
  /** The declared symbol is not exported by the built packages. */
  static readonly MISSING = 'missing';
  /** The symbol's signature hash differs from the lock. */
  static readonly CHANGED = 'changed';
  /** A concept declares the symbol, the lock does not carry it. */
  static readonly UNSTAMPED = 'unstamped';
  /** The declaration is not `<npm name>#<Symbol>` of a declared package. */
  static readonly MALFORMED = 'malformed';
  static readonly SCHEME_SET = new Set<string>([
    this.MISSING,
    this.CHANGED,
    this.UNSTAMPED,
    this.MALFORMED,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}
