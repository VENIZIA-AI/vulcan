/**
 * Board hook (UserPromptSubmit): adds a short block to the turn that a user prompt starts: the flow of the session, its
 * open steps and the exact `vulcan event step` command that ticks one (src/events/prompt-context.ts). Only with `events.log`
 * on, and it never reads the prompt. The turn that a peer or cross-session message starts may not fire this hook, so the
 * Stop hook stays the guarantee.
 *
 * It fails OPEN and prints nothing when there is no flow: input it cannot read, a missing module or any error passes with a
 * note on stderr. `VULCAN_GUARDS=off` switches it off.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { PromptContext } = await import('../../src/events/prompt-context.ts');
  const { FlowState } = await import('../../src/events/flow-state.ts');
  const stdin = await Bun.stdin.text();
  const input = JSON.parse(stdin);
  const block = PromptContext.build({
    root: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    input,
    env: process.env,
    isOver: FlowState.isOver,
  });

  if (block !== undefined) {
    process.stdout.write(`${JSON.stringify(block)}\n`);
  }
} catch (error) {
  console.error(
    `vulcan: the board context hook failed (${error instanceof Error ? error.message : String(error)}) - the turn starts without it`,
  );
}
