import { ProjectLayout } from '../common/constants.ts';
import type { TIsOver } from './common/index.ts';
import { SessionFlow } from './session-flow.ts';

/** The most open steps the block lists. */
const STEPS_LISTED = 5;
/** The longest a step is shown, in characters. */
const STEP_SHOWN = 80;

const shellQuote = (opts: { text: string }): string => `'${opts.text.replaceAll("'", "'\\''")}'`;

/**
 * The `UserPromptSubmit` hook's block: the flow of the session, its open steps and the exact command that ticks one, added
 * to the context of a turn that a user prompt starts. A turn that a peer or cross-session message starts may not fire this
 * hook, so the Stop hold stays the guarantee. Only with `events.log` on; it holds nothing the log did not already redact,
 * and any problem is no block.
 */
export class PromptContext {
  /** The JSON the hook prints, or `undefined` when there is no flow to name. */
  static build(opts: {
    root: string;
    input: unknown;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    now?: number;
  }):
    | { hookSpecificOutput: { hookEventName: 'UserPromptSubmit'; additionalContext: string } }
    | undefined {
    const found = SessionFlow.of(opts);

    if (found === undefined) {
      return undefined;
    }

    const command = `${ProjectLayout.VULCAN_COMMAND} event step --flow ${found.flowId}`;
    const open = (found.last.steps ?? []).filter((step) => !step.done);
    const shown = open.slice(0, STEPS_LISTED);

    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: [
          `Board: you work on flow ${found.flowId} (${found.last.summary}).`,
          open.length === 0
            ? 'It has no open step.'
            : `Open steps (${open.length}):\n${shown.map((step) => `- ${step.text.slice(0, STEP_SHOWN)}`).join('\n')}${open.length > shown.length ? `\n- ... ${open.length - shown.length} more` : ''}`,
          `When one is done: ${command} --done ${shellQuote({ text: shown[0]?.text ?? '<step>' })}`,
        ].join('\n'),
      },
    };
  }
}
