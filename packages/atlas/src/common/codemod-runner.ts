/** The command that runs a project's codemods: a bare binary name, then fixed words. */
export class CodemodRunner {
  static readonly DEFAULT: readonly string[] = ['devz', 'codemod'];
  /** A word of the command: letters, digits, `.`, `_`, `-`; never a path, a flag or a shell word. */
  static readonly WORD_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

  /**
   * The words of `knowledge.codemodCommand` from the manifest; empty when the key is absent. A word that is not
   * allowed throws: dropping it would run another command than the one the project wrote.
   */
  static wordsOf(opts: { value: unknown }): string[] {
    if (opts.value === undefined) {
      return [];
    }

    if (!Array.isArray(opts.value) || opts.value.length === 0) {
      throw new Error('atlas: knowledge.codemodCommand must be a non-empty list of words');
    }

    return opts.value.map((word: unknown) => {
      if (typeof word !== 'string' || !CodemodRunner.WORD_PATTERN.test(word)) {
        throw new Error(
          `atlas: knowledge.codemodCommand word ${JSON.stringify(word)} is not allowed: a word is letters, digits, '.', '_' and '-', and starts with a letter or digit`,
        );
      }

      return word;
    });
  }

  /** What a message names as the listing command, for example `devz codemod --list`. */
  static listLabel(opts: { command?: readonly string[] }): string {
    return [...(opts.command ?? CodemodRunner.DEFAULT), '--list'].join(' ');
  }
}
