/** A value that comes from a manifest or a config and is handed to git as an argument: a repository, a ref. */
export class GitArgument {
  /** Whether git would read the value as an option instead of as the repository or the ref it is meant to be. */
  static isOptionLike(opts: { value: string }): boolean {
    return opts.value.trimStart().startsWith('-');
  }
}
