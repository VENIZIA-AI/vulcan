export class TerminalCapability {
  /**
   * Whether the menus can draw: both ends are a terminal and it understands cursor movement. Anything
   * else (a pipe, a redirect, `TERM=dumb`) keeps the plain questions, so what scripts and logs see does
   * not change.
   */
  static menusAvailable(): boolean {
    return (
      process.stdin.isTTY === true && process.stdout.isTTY === true && process.env.TERM !== 'dumb'
    );
  }
}
