/**
 * Whether the menus can draw: both ends are a terminal and it understands cursor movement. Anything
 * else (a pipe, a redirect, `TERM=dumb`) keeps the plain questions, so what scripts and logs see does
 * not change.
 */
export const menusAvailable = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true && process.env.TERM !== 'dumb';
