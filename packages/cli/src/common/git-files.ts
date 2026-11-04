/** What git says about a project's files. */
export class GitFiles {
  /** The paths git tracks in `root`, or git's own message when it cannot say (not a repository, git missing). */
  static tracked(opts: { root: string }): { files: string[] } | { error: string } {
    const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: opts.root, timeout: 30_000 });

    return result.exitCode === 0
      ? { files: result.stdout.toString().split('\0').filter(Boolean) }
      : { error: result.stderr.toString().trim() };
  }
}
