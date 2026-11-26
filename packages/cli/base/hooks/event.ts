/**
 * Event log hook (SessionStart, SubagentStart, SubagentStop, Notification and PostToolUse of SendMessage, TodoWrite, Bash
 * and the edit tools): appends at most one line to the agent event log (src/events/hook.ts) when the manifest says
 * `events.log` is on; a Write, Edit, MultiEdit or NotebookEdit call writes no line, only the time of the session's last
 * edit, for the Stop hook. It stores names and short labels only -
 * never a message body, the last reply, a command, a path or anything of a tool's input or result, except
 * the step text of a `TodoWrite` call, which becomes the steps of the flow (cleaned and redacted), and the class
 * of a `Bash` call (a commit, a pull request opened or merged: the command is read here only to classify it and never
 * logged), and, at a subagent's stop, the transcript of that subagent, of which only the ids, the model and the token
 * counts are read and stored.
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

    if (activity !== undefined) {
      const state = await import('../../src/events/flow-state.ts');

      isOver = state.FlowState.isOver;
    }
  }

  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  EventHook.run({
    root,
    input,
    env: process.env,
    ...(isOver === undefined ? {} : { isOver }),
    ...(activity === undefined ? {} : { activity }),
  });

  // A subagent that stopped: its tokens go to the log, on the flow of its branch, else its parent session's. A meter that fails is its own note
  // and never undoes the line already written.
  if (input?.hook_event_name === 'SubagentStop') {
    try {
      const meter = await import('../../src/events/usage.ts');

      meter.UsageMeter.recordSubagent({ root, input, env: process.env });
    } catch (error) {
      console.error(
        `vulcan: the token meter failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
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
