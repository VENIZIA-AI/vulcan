/**
 * Event log hook (SessionStart, Stop, SubagentStop, Notification and PostToolUse: a SendMessage is a message,
 * any other tool at most one tick per session every 30 seconds): appends one line to the agent event log
 * (src/events/hook.ts) when the manifest says `events.log` is on. It stores names and short labels only -
 * never a message body, the last reply, a command, a path or anything of a tool's input or result, except
 * the step text of a `TodoWrite` call, which becomes the steps of the flow (cleaned and redacted), and the class
 * of a `Bash` call (a commit, a pull request opened or merged: the command is read here only to classify it and never logged).
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
  const input = JSON.parse(stdin);
  // The board's fold is loaded only for a task list, the one call that must know whether a flow is over.
  let isOver;
  let activity;

  if (input?.tool_name === 'TodoWrite') {
    const state = await import('../../src/events/flow-state.ts');

    isOver = state.FlowState.isOver;
  }

  // Only a line that names git, gh or glab is read as a command; every other shell call costs nothing more here.
  const command = input?.tool_input?.command;

  if (
    input?.tool_name === 'Bash' &&
    typeof command === 'string' &&
    /\b(git|gh|glab)\b/.test(command)
  ) {
    const found = await import('../../src/hooks/git-activity.ts');

    activity = found.GitActivity.classify({ command });
  }

  EventHook.run({
    root: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    input,
    env: process.env,
    ...(isOver === undefined ? {} : { isOver }),
    ...(activity === undefined ? {} : { activity }),
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
