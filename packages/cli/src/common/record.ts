/** The one answer to "is this parsed JSON or YAML a plain object": not an array, not null. */
export class RecordValue {
  /** Takes the value itself, not an options object: a type predicate narrows only a parameter, and callers read `value.key` afterwards. */
  static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** The value when it is a string, else the empty string. */
  static textOf(opts: { value: unknown }): string {
    return typeof opts.value === 'string' ? opts.value : '';
  }
}
