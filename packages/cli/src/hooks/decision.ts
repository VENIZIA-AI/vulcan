import { GuardDecisions, HookConstants } from './common/index.ts';
import type { TGuardDecision } from './common/index.ts';

export interface IDecisionOutput {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: string;
    permissionDecisionReason: string;
  };
}

/**
 * The decision as every host that reads our hooks understands it. Claude Code and Cursor read
 * \`hookSpecificOutput\`; Copilot documents the same two fields at the top level, so they are written there
 * too (Claude Code ignores them: checked). Cursor does not enforce an \`ask\` on a tool call, so where it
 * says it is running the hook (\`CURSOR_PROJECT_DIR\`) an ask is a deny that says why.
 */
export const forHost = (opts: {
  output: IDecisionOutput;
  env?: Record<string, string | undefined>;
}) => {
  const specific = opts.output.hookSpecificOutput;
  const env = opts.env ?? process.env;
  const isCursorAsk =
    specific.permissionDecision === GuardDecisions.ASK &&
    env[HookConstants.CURSOR_PROJECT_DIR_ENV] !== undefined;
  const decision = isCursorAsk ? GuardDecisions.DENY : specific.permissionDecision;
  const reason = isCursorAsk
    ? `${specific.permissionDecisionReason}\n(Cursor cannot ask about a tool call: hand this to the owner)`
    : specific.permissionDecisionReason;

  return {
    hookSpecificOutput: {
      ...specific,
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
    permissionDecision: decision,
    permissionDecisionReason: reason,
  };
};

/** The PreToolUse answer Claude Code reads from stdout: the decision and why, shown to the human or to the model. */
export const buildToolDecision = (opts: { decision: TGuardDecision; reason: string[] }) =>
  forHost({
    output: {
      hookSpecificOutput: {
        hookEventName: HookConstants.PRE_TOOL_USE,
        permissionDecision: opts.decision,
        permissionDecisionReason: opts.reason.join('\n'),
      },
    },
  });

/** Whether the session switched the guards off (`VULCAN_GUARDS=off`): every call then passes. */
export const guardsAreOff = (opts: { env?: Record<string, string | undefined> } = {}): boolean =>
  (opts.env ?? process.env)[HookConstants.KILL_SWITCH_ENV] === HookConstants.KILL_SWITCH_OFF;
