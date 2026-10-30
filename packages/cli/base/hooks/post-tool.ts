/**
 * PostToolUse and PostToolUseFailure hook: keeps small notes about the turn for the Stop check (was public
 * state probed, did the last gate pass) and tells the model when it seems stuck - the same call three times,
 * two calls alternating, one tool failing again and again - or when it just changed a skill or a rules file.
 * It never blocks and it fails OPEN. It imports only the signals module: no config, no zod, because it runs
 * after every tool call. `VULCAN_GUARDS=off` switches it off, read before anything is imported.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { buildPostToolOutput } = await import('../../src/hooks/post-tool.ts');
  const stdin = await Bun.stdin.text();
  const output = buildPostToolOutput({
    projectRoot: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    input: JSON.parse(stdin),
  });

  if (output !== undefined) {
    console.log(JSON.stringify(output));
  }
} catch (error) {
  // Input that is not JSON is not echoed: Bun's parse error quotes it.
  const reason =
    error instanceof SyntaxError
      ? 'unreadable input'
      : error instanceof Error
        ? error.message
        : String(error);

  console.error(`vulcan: the post-tool hook failed (${reason}) - the call is unaffected`);
}
