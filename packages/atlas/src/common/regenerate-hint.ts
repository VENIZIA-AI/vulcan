export class RegenerateHint {
  /** What a stale check tells the person: the tool command works in any project, a make target may not exist. */
  static regenerateHintOf(opts: { command: string }): string {
    return `run \`vulcan x atlas ${opts.command} gen\``;
  }
}
