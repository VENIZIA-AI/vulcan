import { RecordValue } from '../common/record.ts';
import { ClaudeHookEvents, EventConstants, EventKinds, EventSources } from './common/index.ts';
import type { IEvent, IHookEvent } from './common/index.ts';
import { EventActor } from './actor.ts';
import { EventFlow } from './flow.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';
import { EventText } from './text.ts';

const text = (opts: { value: unknown }): string =>
  typeof opts.value === 'string' ? opts.value : '';

/** What Claude Code tells a hook, turned into log lines. It reads names and short labels, never bodies. */
export class EventHook {
  /**
   * The event a payload stands for, or `undefined` when the payload is not one to log. Only these fields are
   * read: `source` and `model` of a session start, `stop_hook_active` of a stop, `agent_type` and `agent_id` of a
   * subagent stop, `notification_type` and `title` of a notification, and `to` and `summary` of a SendMessage
   * call (its first line, only when the sender gave no summary). `last_assistant_message`, `message`,
   * `tool_response` and every command stay unread.
   */
  static map(opts: { input: unknown }): IHookEvent | undefined {
    const { input } = opts;

    if (!RecordValue.isRecord(input)) {
      return undefined;
    }

    switch (input.hook_event_name) {
      case ClaudeHookEvents.SESSION_START: {
        return {
          kind: EventKinds.SESSION_START,
          summary: [text({ value: input.source }), text({ value: input.model })]
            .filter((word) => word !== '')
            .join(' '),
        };
      }

      case ClaudeHookEvents.STOP: {
        return input.stop_hook_active === true
          ? undefined
          : { kind: EventKinds.SESSION_STOP, summary: 'turn ended' };
      }

      case ClaudeHookEvents.SUBAGENT_STOP: {
        return {
          kind: EventKinds.SUBAGENT_STOP,
          summary: [text({ value: input.agent_type }), text({ value: input.agent_id })]
            .filter((word) => word !== '')
            .join(' '),
        };
      }

      case ClaudeHookEvents.NOTIFICATION: {
        const type = text({ value: input.notification_type });

        return ClaudeHookEvents.OWNER_NOTIFICATIONS.has(type)
          ? { kind: EventKinds.NEEDS_OWNER, summary: text({ value: input.title }) || type }
          : undefined;
      }

      case ClaudeHookEvents.POST_TOOL_USE: {
        return EventHook.mapSend({ input });
      }

      default: {
        return undefined;
      }
    }
  }

  private static mapSend(opts: { input: Record<string, unknown> }): IHookEvent | undefined {
    const { input } = opts;
    const call = input.tool_input;

    if (input.tool_name !== ClaudeHookEvents.SEND_MESSAGE_TOOL || !RecordValue.isRecord(call)) {
      return undefined;
    }

    // Only a send that failed on its own account is left out; a reply shape this does not know still logs.
    if (RecordValue.isRecord(input.tool_response) && input.tool_response.success === false) {
      return undefined;
    }

    const message = text({ value: call.message });
    const label = EventText.oneLine({
      text: text({ value: call.summary }),
      max: EventConstants.SUMMARY_MAX,
    });
    const recipient = text({ value: call.to });

    return {
      kind: EventKinds.MSG_SENT,
      summary:
        label === ''
          ? EventText.oneLine({
              text: EventText.firstLine({ text: message }),
              max: EventConstants.FALLBACK_MAX,
            })
          : label,
      ...(recipient === '' ? {} : { ref: `to:${recipient}` }),
      flowText: message,
    };
  }

  /**
   * Logs what a payload stands for, when the manifest says the log is on. Returns the line it wrote.
   * `root` is the project, where the manifest is; the flow comes from the message, else the branch at the
   * payload's `cwd`.
   */
  static run(opts: {
    root: string;
    input: unknown;
    env: Record<string, string | undefined>;
    now?: number;
  }): IEvent | undefined {
    const settings = EventSettings.read({ root: opts.root });

    if (!settings.log) {
      return undefined;
    }

    const mapped = EventHook.map({ input: opts.input });

    if (mapped === undefined || !RecordValue.isRecord(opts.input)) {
      return undefined;
    }

    const cwd = text({ value: opts.input.cwd }) || opts.root;
    const flowId =
      (mapped.flowText === undefined ? undefined : EventFlow.fromText({ text: mapped.flowText })) ??
      EventFlow.fromBranch({ cwd });
    const event = EventLog.build({
      kind: mapped.kind,
      summary: mapped.summary,
      actor: EventActor.resolve({
        sessionId: text({ value: opts.input.session_id }),
        env: opts.env,
      }),
      source: EventSources.CLAUDE_HOOK,
      ...(flowId === undefined ? {} : { flowId }),
      ...(mapped.ref === undefined ? {} : { ref: mapped.ref }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });

    EventLog.append({ dir: EventSettings.dirOf({ root: opts.root, settings }), event });

    return event;
  }
}
