/**
 * A step that may throw, answered by a fallback when it does: the shape of a catch whose only answer is a value.
 * It imports nothing, so the guard hooks load it with no other package resolvable.
 */
export class FallbackUtility {
  /** What `read` returns, or `otherwise` when it throws. */
  static of<TValue, TOtherwise>(opts: {
    read: () => TValue;
    otherwise: TOtherwise;
  }): TValue | TOtherwise {
    try {
      return opts.read();
    } catch {
      return opts.otherwise;
    }
  }

  /** Runs a best-effort step: a throw leaves things as they are. */
  static attempt(opts: { run: () => void }): void {
    FallbackUtility.of({ read: opts.run, otherwise: undefined });
  }

  /** The value of a JSON text, or `undefined` when it is not JSON (JSON itself never parses to `undefined`). */
  static parseJson(opts: { text: string }): unknown {
    return FallbackUtility.of({ read: (): unknown => JSON.parse(opts.text), otherwise: undefined });
  }
}
