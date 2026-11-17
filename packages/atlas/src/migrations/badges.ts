/** The two spellings of the badge that marks a breaking change; only the long one is canonical. */
export class BreakingBadge {
  static readonly CANONICAL = 'Breaking Change';
  static readonly SHORT = 'Breaking';
  /** A `<Badge ... text="Breaking" />` or `text="Breaking Change"` anywhere in the entry's text. */
  static readonly PATTERN = /<Badge[^>]*\stext="Breaking(?: Change)?"/;
  static readonly SHORT_PATTERN = /<Badge[^>]*\stext="Breaking"/;

  /** `text` with the short spelling replaced by the canonical one; any other badge text as it is. */
  static canonical(opts: { text: string }): string {
    return opts.text === BreakingBadge.SHORT ? BreakingBadge.CANONICAL : opts.text;
  }

  /** Whether any badge of the entry, in its text or in its `badges:` list, says breaking. */
  static isIn(opts: { text: string; badges: unknown[] }): boolean {
    return (
      BreakingBadge.PATTERN.test(opts.text) ||
      opts.badges.includes(BreakingBadge.CANONICAL) ||
      opts.badges.includes(BreakingBadge.SHORT)
    );
  }
}
