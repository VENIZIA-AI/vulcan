/**
 * Event log hook (SessionStart, Stop, SubagentStop, Notification, PostToolUse on SendMessage): appends one
 * line to the agent event log (src/events/hook.ts) when the manifest says `events.log` is on. It stores
 * names and short labels only - never a message body, the last reply, a command or a file path.
 *
 * It fails OPEN and says nothing on stdout: input it cannot read, a missing module or a write that fails
 * pass with a note on stderr, and the agent is never held. It imports only the events module, no config and
 * no zod, because it runs on every session event. `VULCAN_GUARDS=off` switches it off.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { EventHook } = await import('../../src/events/hook.ts');
  const stdin = await Bun.stdin.text();

  EventHook.run({
    root: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    input: JSON.parse(stdin),
    env: process.env,
  });
} catch (error) {
  // Input that is not JSON is not echoed: Bun's parse error quotes it.
  const reason =
    error instanceof SyntaxError
      ? 'unreadable input'
      : error instanceof Error
        ? error.message
        : String(error);

  console.error(`vulcan: the event hook failed (${reason}) - the event is not logged`);
}
