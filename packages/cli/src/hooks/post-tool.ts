import {
  appendSignal,
  callKeyOf,
  EntryKinds,
  gatesOf,
  isPublicProbe,
  loopOf,
  readSignals,
  SignalConstants,
  watchedFileOf,
  WatchedKinds,
} from '../signals/index.ts';
import type { ISignalState } from '../signals/index.ts';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FAILURE_EVENT = 'PostToolUseFailure';

const recordOf = (opts: { value: unknown }): Record<string, unknown> =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value)
    ? Object.fromEntries(Object.entries(opts.value))
    : {};

const stringOf = (opts: { value: unknown }): string =>
  typeof opts.value === 'string' ? opts.value : '';

/** Whether the tool reported a failure in its own result: an exit code, an error flag, an interruption. */
const reportsFailure = (opts: { response: Record<string, unknown> }): boolean => {
  const { response } = opts;
  const code = response['exitCode'] ?? response['exit_code'];

  return (
    (typeof code === 'number' && code !== 0) ||
    response['is_error'] === true ||
    response['isError'] === true ||
    response['interrupted'] === true
  );
};

/**
 * What the model is told after a tool call, and the line it adds to the turn's notes: whether the turn
 * asked public state, which gate commands ran and passed or failed, the calls themselves, so a loop shows.
 * It speaks only to say that the agent seems stuck, or that a skill or rules file was just changed; it
 * never blocks. Notes are kept per session, and a loop per agent. Input it cannot read gives no answer.
 */
export const buildPostToolOutput = (opts: {
  projectRoot: string;
  input: unknown;
  now?: number;
}): Record<string, unknown> | undefined => {
  const input = recordOf({ value: opts.input });
  const tool = stringOf({ value: input['tool_name'] });

  if (tool === '') {
    return undefined;
  }

  const now = opts.now ?? Date.now();
  const session = stringOf({ value: input['session_id'] });
  const agent = stringOf({ value: input['agent_id'] });
  const toolInput = recordOf({ value: input['tool_input'] });
  const event = input['hook_event_name'] === FAILURE_EVENT ? FAILURE_EVENT : 'PostToolUse';
  const isOk =
    event !== FAILURE_EVENT &&
    !reportsFailure({ response: recordOf({ value: input['tool_response'] }) });
  const command = stringOf({ value: toolInput['command'] });
  // A command sent to the background has not finished: its result is not known here.
  const isBackground = toolInput['run_in_background'] === true;
  const path = stringOf({ value: toolInput['file_path'] });
  const gates = tool === 'Bash' && !isBackground ? gatesOf({ command }) : [];

  try {
    appendSignal({
      root: opts.projectRoot,
      entry: {
        kind: EntryKinds.CALL,
        session,
        agent,
        at: now,
        tool,
        key: callKeyOf({ tool, input: toolInput }),
        isOk,
        isProbe: tool === 'Bash' && isOk && isPublicProbe({ command }),
        gates,
        isEdit: FILE_TOOLS.has(tool) && isOk,
      },
    });
  } catch {
    // The notes are advisory: a failed write costs a hint, never the call.
  }

  const state: ISignalState = readSignals({ root: opts.projectRoot, session, agent });
  const lines: string[] = [];
  const say = (name: string, line: string): void => {
    const last = state.notedAt[name];

    if (last !== undefined && now - last < SignalConstants.DEBOUNCE_MS) {
      return;
    }

    lines.push(line);

    try {
      appendSignal({ root: opts.projectRoot, entry: { kind: EntryKinds.NOTE, at: now, name } });
    } catch {
      // Without the note the advisory may repeat; nothing worse.
    }
  };

  if (FILE_TOOLS.has(tool) && isOk) {
    const watched = watchedFileOf({ path });

    if (watched?.kind === WatchedKinds.SKILL) {
      say(
        `skill:${watched.name}`,
        `You changed the skill ${watched.name}. Before you rely on it, run its evals (evals/evals.json) and read the transcripts: a skill change that no eval saw is a guess.`,
      );
    } else if (watched?.kind === WatchedKinds.RULES) {
      say(
        `rules:${watched.name}`,
        'You changed a rules file. A rule needs an observed failure and a named enforcement, and a mechanical check where one is possible (the retro skill states the admission bar).',
      );
    }
  }

  const loop = loopOf({ events: state.events });

  if (loop !== undefined) {
    say(
      `loop:${agent}`,
      `Loop check: ${loop}. Stop repeating it: read the error, change the approach (the fix-a-bug skill builds the loop first), or ask the owner.`,
    );
  }

  return lines.length === 0
    ? undefined
    : { hookSpecificOutput: { hookEventName: event, additionalContext: lines.join(' ') } };
};
