/** Reading what is `unknown` (parsed YAML, JSON) as a plain object without a cast. */
export class RecordValue {
  /** `value` when it is a plain object (not an array, not null), else an empty record. */
  static orEmpty(opts: { value: unknown }): Record<string, unknown> {
    return RecordValue.isRecord(opts) ? opts.value : {};
  }

  private static isRecord(opts: { value: unknown }): opts is { value: Record<string, unknown> } {
    return typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);
  }
}
