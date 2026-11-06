/** A value that comes from a manifest or a config and is handed to git, or to a child process, as an argument: a repository, a ref, a source name. */
export class GitArgument {
  /** A source name: letters, digits, `_`, `.` and `-`, starting with a letter or a digit, so it is never read as a flag. */
  static readonly SOURCE_NAME = /^[A-Za-z0-9][\w.-]*$/;

  /** Whether git would read the value as an option instead of as the repository or the ref it is meant to be. */
  static isOptionLike(opts: { value: string }): boolean {
    return opts.value.trimStart().startsWith('-');
  }

  /** Whether the value can be a source name. */
  static isSourceName(opts: { value: string }): boolean {
    return GitArgument.SOURCE_NAME.test(opts.value);
  }
}
