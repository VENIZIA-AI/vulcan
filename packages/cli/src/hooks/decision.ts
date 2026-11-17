import { GuardDecisions, HookConstants } from './common/index.ts';
import type { TGuardDecision } from './common/index.ts';

interface IDecisionOutput {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: string;
    permissionDecisionReason: string;
  };
}

export class HookDecision {
  /**
   * The decision as every host that reads our hooks understands it. Claude Code and Cursor read
   * `hookSpecificOutput`; Copilot documents the same two fields at the top level, so they are written there
   * too (Claude Code ignores them: checked). Cursor does not enforce an `ask` on a tool call, so where it
   * says it is running the hook (`CURSOR_PROJECT_DIR`) an ask is a deny that says why. A project that sets `guard.asks: 'deny'`
   * (`asks`) gets every ask as a deny too, because where the agent runs in an auto mode an ask can be approved with no human.
   */
  static forHost(opts: {
    output: IDecisionOutput;
    env?: Record<string, string | undefined>;
    asks?: string;
    /** What the added line says when the ask is held; the project's own wording when it is not given. */
    asksNote?: string;
  }) {
    const specific = opts.output.hookSpecificOutput;
    const env = opts.env ?? process.env;
    const isAsk = specific.permissionDecision === GuardDecisions.ASK;
    const isHeld = isAsk && opts.asks === GuardDecisions.DENY;
    const isCursorAsk = isAsk && env[HookConstants.CURSOR_PROJECT_DIR_ENV] !== undefined;
    const decision = isHeld || isCursorAsk ? GuardDecisions.DENY : specific.permissionDecision;
    let reason = specific.permissionDecisionReason;

    if (isHeld) {
      reason = `${reason}\n\n${opts.asksNote ?? HookConstants.HELD_ASK}`;
    } else if (isCursorAsk) {
      reason = `${reason}\n(Cursor cannot ask about a tool call: hand this to the owner)`;
    }

    return {
      hookSpecificOutput: {
        ...specific,
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
      permissionDecision: decision,
      permissionDecisionReason: reason,
    };
  }

  /** The PreToolUse answer Claude Code reads from stdout: the decision and why, shown to the human or to the model. */
  static buildTool(opts: {
    decision: TGuardDecision;
    reason: string[];
    asks?: string;
    asksNote?: string;
  }) {
    return HookDecision.forHost({
      asks: opts.asks,
      asksNote: opts.asksNote,
      output: {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          permissionDecision: opts.decision,
          permissionDecisionReason: opts.reason.join('\n'),
        },
      },
    });
  }
}
