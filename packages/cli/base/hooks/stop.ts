/**
 * Stop hook: checks the reply that just ended against the owner's report shape (src/owner/shape.ts) and
 * records its faults by class and date, never the text. Under `enforce: block` a structural fault sends
 * the reply back once to be restated; otherwise it only logs, and the next prompt's contract names it.
 *
 * It fails OPEN: a Stop hook runs after the message is on screen, and one that fails must not hold a
 * session. Input it cannot read, a missing module or an internal error pass with a note on stderr.
 * `VULCAN_GUARDS=off` switches it off, read before anything is imported.
 * `VULCAN_OWNER_REPLY=off` exempts a session whose reader is an agent; the check is made in the builder.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { buildStopOutput } = await import('../../src/hooks/owner-reply.ts');
  const stdin = await Bun.stdin.text();
  const output = await buildStopOutput({
    projectRoot: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    input: JSON.parse(stdin),
  });

  if (output !== undefined) {
    console.log(JSON.stringify(output));
  }
} catch (error) {
  // Input that is not JSON is not echoed: Bun's parse error quotes it, and it can hold the reply.
  const reason =
    error instanceof SyntaxError
      ? 'unreadable input'
      : error instanceof Error
        ? error.message
        : String(error);

  console.error(`vulcan: the stop hook failed (${reason}) - the reply passes`);
}
