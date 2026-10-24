import { HookConstants } from './common/index.ts';
import type { TGuardDecision } from './common/index.ts';

/** The PreToolUse answer Claude Code reads from stdout: the decision and why, shown to the human or to the model. */
export const buildToolDecision = (opts: { decision: TGuardDecision; reason: string[] }) => ({
  hookSpecificOutput: {
    hookEventName: HookConstants.PRE_TOOL_USE,
    permissionDecision: opts.decision,
    permissionDecisionReason: opts.reason.join('\n'),
  },
});

/** Whether the session switched the guards off (`VULCAN_GUARDS=off`): every call then passes. */
export const guardsAreOff = (opts: { env?: Record<string, string | undefined> } = {}): boolean =>
  (opts.env ?? process.env)[HookConstants.KILL_SWITCH_ENV] === HookConstants.KILL_SWITCH_OFF;
