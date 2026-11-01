/** Text helpers that more than one folder of atlas needs. */
export class TextValue {
  /** Code-point order, not locale order: a sorted list and a hash over it read the same on every machine. */
  static compare(opts: { left: string; right: string }): number {
    if (opts.left === opts.right) {
      return 0;
    }

    return opts.left < opts.right ? -1 : 1;
  }

  static messageOf(opts: { error: unknown }): string {
    return opts.error instanceof Error ? opts.error.message : String(opts.error);
  }

  /** `text` as a regular expression that matches exactly itself. */
  static escapeLiteral(opts: { text: string }): string {
    return opts.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
