/** The one answer to "is this parsed YAML or JSON a plain object": a mapping, not an array, not null. */
export class RecordValue {
  static isRecord(opts: { value: unknown }): opts is { value: Record<string, unknown> } {
    return typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);
  }
}
