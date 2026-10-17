/** What a stale check tells the person: the tool command works in any project, a make target may not exist. */
export const regenerateHintOf = (opts: { command: string }): string =>
  `run \`vulcan x atlas ${opts.command} gen\``;
