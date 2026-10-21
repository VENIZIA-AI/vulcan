import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'cli.ts');
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');
const COLOUR = new RegExp(`${ESC}\\[(?:3[0-7]|9[0-7])m`);
const POLL_MS = 25;
const SETTLE_MS = 60;
const STEP_TIMEOUT_MS = 20_000;
const COLUMNS = 120;
const ROWS = 40;

export const KEYS = {
  ENTER: '\r',
  SPACE: ' ',
  DOWN: `${ESC}[B`,
  UP: `${ESC}[A`,
  ESCAPE: ESC,
  CTRL_C: String.fromCharCode(3),
} as const;

/** One key press, sent once `waitFor` has shown up in what the command printed after the previous step. */
export interface ITerminalStep {
  waitFor: string;
  send: string;
}

/** Whether the output carries a foreground colour sequence. */
export const hasColour = (opts: { output: string }): boolean => COLOUR.test(opts.output);

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs the CLI under a pseudo-terminal (`script`) and presses keys when the menu they answer is on
 * screen, never on a timer: a menu draws itself, so a key sent before it is a key lost. `plain` is
 * the output without colour and cursor sequences; `output` keeps them.
 */
export const driveTerminal = async (opts: {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  steps: ITerminalStep[];
}): Promise<{ code: number; output: string; plain: string }> => {
  // A pseudo-terminal starts 0 columns wide, and a menu wraps every character onto its own line.
  const command = `stty cols ${COLUMNS} rows ${ROWS} && exec ${[process.execPath, CLI, ...opts.args].map(quote).join(' ')}`;
  const child = Bun.spawn(['script', '-qec', command, '/dev/null'], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let output = '';
  const decoder = new TextDecoder();
  const reading = (async () => {
    for await (const chunk of child.stdout) {
      output += decoder.decode(chunk);
    }
  })();
  const plainOf = (): string => output.replace(ANSI, '');
  let cursor = 0;

  try {
    for (const step of opts.steps) {
      const started = Date.now();
      let at = plainOf().indexOf(step.waitFor, cursor);

      while (at === -1) {
        if (Date.now() - started > STEP_TIMEOUT_MS) {
          throw new Error(
            `[driveTerminal] '${step.waitFor}' never appeared | output so far: ${plainOf().slice(cursor).slice(-600)}`,
          );
        }

        await sleep(POLL_MS);
        at = plainOf().indexOf(step.waitFor, cursor);
      }

      cursor = at + step.waitFor.length;
      await sleep(SETTLE_MS);
      await child.stdin.write(step.send);
      await child.stdin.flush();
    }

    const code = await Promise.race([
      child.exited,
      sleep(STEP_TIMEOUT_MS).then(() => {
        throw new Error(`[driveTerminal] did not exit | output tail: ${plainOf().slice(-600)}`);
      }),
    ]);

    await reading;

    return { code, output, plain: plainOf() };
  } finally {
    child.kill('SIGKILL');
  }
};
