/**
 * UserPromptSubmit hook: adds one line to the prompt while the owner's report shape is held - the
 * contract, and the faults of the previous reply when it had any. Nothing is added when the shape is not
 * enforced. It never blocks a prompt: any failure prints a note and the prompt goes through.
 * `VULCAN_GUARDS=off` switches it off, read before anything is imported.
 * `VULCAN_OWNER_REPLY=off` exempts a session whose reader is an agent; the check is made in the builder.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { buildPromptContract } = await import('../../src/hooks/owner-reply.ts');
  let session = '';

  try {
    const event: unknown = JSON.parse(await Bun.stdin.text());

    if (
      typeof event === 'object' &&
      event !== null &&
      'session_id' in event &&
      typeof event.session_id === 'string'
    ) {
      session = event.session_id;
    }
  } catch {
    // No readable event: the turn is noted for no session, and nothing is echoed.
  }

  const line = await buildPromptContract({
    projectRoot: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    session,
  });

  if (line !== '') {
    console.log(line);
  }
} catch (error) {
  // Input that is not JSON is not echoed: Bun's parse error quotes it, and it can hold the reply.
  const reason =
    error instanceof SyntaxError
      ? 'unreadable input'
      : error instanceof Error
        ? error.message
        : String(error);

  console.error(`vulcan: the prompt-submit hook failed (${reason}) - the prompt goes through`);
}
