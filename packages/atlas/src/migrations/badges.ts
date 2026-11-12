/** The two spellings of the badge that marks a breaking change; only the long one is canonical. */
export class BreakingBadge {
  static readonly CANONICAL = 'Breaking Change';
  static readonly SHORT = 'Breaking';

  /** `text` with the short spelling replaced by the canonical one; any other badge text as it is. */
  static canonical(opts: { text: string }): string {
    return opts.text === BreakingBadge.SHORT ? BreakingBadge.CANONICAL : opts.text;
  }
}
