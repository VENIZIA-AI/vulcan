/**
 * Board hook (Stop): first records the tokens of the turn as `usage` lines (src/events/usage.ts; numbers and a model only),
 * then holds the end of a turn once when the board is out of step with the work of the turn (a commit, a
 * pull request, or an edit tool of this session and an edit of tracked files, since the flow's last line, or a merge with
 * steps still open) and prints the
 * exact `vulcan event step` command to run (src/events/stop.ts). Only with `events.log` on.
 *
 * It fails OPEN: input it cannot read, a missing module, a git that is slow or absent, any error passes with a note on
 * stderr and no block. `VULCAN_GUARDS=off` switches it off.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { BoardStop } = await import('../../src/events/stop.ts');
  const { FlowState } = await import('../../src/events/flow-state.ts');
  const { UsageMeter } = await import('../../src/events/usage.ts');
  const stdin = await Bun.stdin.text();
  const input = JSON.parse(stdin);
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  // The tokens of the turn go to the log first, whatever the board says next. A meter that fails never holds the turn.
  try {
    if (typeof input === 'object' && input !== null) {
      UsageMeter.recordSession({ root, input, env: process.env, isOver: FlowState.isOver });
    }
  } catch (error) {
    console.error(
      `vulcan: the token meter failed (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const decision = BoardStop.decide({
    root,
    input,
    env: process.env,
    isOver: FlowState.isOver,
  });

  if (decision !== undefined) {
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  }
} catch (error) {
  const reason =
    error instanceof SyntaxError
      ? 'unreadable input'
      : error instanceof Error
        ? error.message
        : String(error);

  console.error(`vulcan: the board stop hook failed (${reason}) - the turn ends`);
}
