export class WireValue {
  /**
   * Reading what GitHub sends. A reply is `unknown` until narrowed here, and a snake_case wire name is
   * read through a string-literal key at the call site (V-C-14), never typed as a property of ours.
   */
  static recordOf(opts: { value: unknown }): Record<string, unknown> {
    return typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value)
      ? Object.fromEntries(Object.entries(opts.value))
      : {};
  }

  static itemsOf(opts: { value: unknown }): unknown[] {
    return Array.isArray(opts.value) ? opts.value : [];
  }

  static stringOf(opts: { value: unknown }): string | undefined {
    return typeof opts.value === 'string' ? opts.value : undefined;
  }

  static numberOf(opts: { value: unknown }): number | undefined {
    return typeof opts.value === 'number' ? opts.value : undefined;
  }
}
