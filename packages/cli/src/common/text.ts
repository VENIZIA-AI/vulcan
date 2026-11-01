/** Text helpers that more than one folder of the CLI needs. */
export class TextValue {
  /** `text` as a regular expression that matches exactly itself. */
  static escapeLiteral(opts: { text: string }): string {
    return opts.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
