const LINE_FEED = 0x0a;
const SHOW_CURSOR = '\u001b[?25h';
const REFUSAL = [
  'vulcan: this menu reads key presses, not lines, and got a line of piped input (LF).',
  'Pass the flags instead (for example --agents claude,omp; see --help of the command), or set TERM=dumb to keep the plain line questions.',
].join('\n');

/**
 * A keyboard in raw mode sends CR for Enter, never LF. LF means the answers were piped in (a script
 * feeding a pty), and a menu would wait for a key that never comes. So while a menu is open, the first
 * LF restores the terminal and ends the command with the way out: a refusal, not a hang.
 */
export const guardAgainstPipedLines = async <TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> => {
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
    process.exit(1);
  };

  process.stdin.on('data', refuse);

  try {
    return await run();
  } finally {
    process.stdin.off('data', refuse);
  }
};
