export class InteractiveRun {
  /**
   * A bare `vulcan-atlas` typed at a terminal: no subcommand and stdin is a TTY. MCP is the default for a
   * client, whose stdin is a pipe; a person at a prompt would only see it wait, so they get the usage.
   */
  static isBare(opts: { argv: string[]; isTty: boolean }): boolean {
    return opts.argv.length === 0 && opts.isTty;
  }
}
