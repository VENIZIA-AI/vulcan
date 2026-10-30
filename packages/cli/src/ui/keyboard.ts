const LINE_FEED = 0x0a;
const SHOW_CURSOR = '\u001b[?25h';
const REFUSAL = [
  'vulcan: this menu reads key presses, not lines, and got a line of piped input (LF).',
  'Pass the flags instead (for example --agents claude,omp; see --help of the command), or set TERM=dumb to keep the plain line questions.',
].join('\n');

/** The command was given piped lines where a menu needs key presses; the way out is already printed. */
export class PipedInputRefusal extends Error {}

/**
 * A keyboard in raw mode sends CR for Enter, never LF. LF means the answers were piped in (a script
 * feeding a pty), and a menu would wait for a key that never comes. So while a menu is open, the first
 * LF restores the terminal, prints the way out and ends the menu with a `PipedInputRefusal`: a
 * refusal, not a hang. It is thrown, not `process.exit`, so the `finally` blocks of the flow run (the
 * scratch folder of a preset is removed) and the router turns it into exit code 1.
 */
export const guardAgainstPipedLines = async <TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> => {
  let refuseMenu: (error: PipedInputRefusal) => void = () => {};
  const refused = new Promise<never>((_resolve, reject) => {
    refuseMenu = reject;
  });
  const refuse = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;

    if (!bytes.includes(LINE_FEED)) {
      return;
    }

    if (process.stdin.isTTY === true) {
      process.stdin.setRawMode(false);
    }

    process.stdout.write(SHOW_CURSOR);
    process.stderr.write(`\n${REFUSAL}\n`);
    refuseMenu(new PipedInputRefusal(REFUSAL));
  };

  process.stdin.on('data', refuse);

  try {
    const outcome = await Promise.race([run(), refused]);

    return outcome;
  } finally {
    process.stdin.off('data', refuse);
  }
};
