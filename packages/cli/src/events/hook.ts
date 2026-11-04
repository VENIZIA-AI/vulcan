import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
   * call (its first line, only when the sender gave no summary). A tool tick reads nothing but the event's name.
   * `last_assistant_message`, `message`, `tool_response`, `tool_input` and every command stay unread.
   */
  static map(opts: { input: unknown }): IHookEvent | undefined {
    const { input } = opts;

    if (!RecordValue.isRecord(input)) {
      return undefined;
    }

    switch (input.hook_event_name) {
      case ClaudeHookEvents.SESSION_START: {
        const model = text({ value: input.model });

        return {
          kind: EventKinds.SESSION_START,
          summary: [text({ value: input.source }), model].filter((word) => word !== '').join(' '),
          ...(model === '' ? {} : { model }),
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
          ? {
              kind: EventKinds.NEEDS_OWNER,
              summary: text({ value: input.title }) || type,
              notification: type,
            }
          : undefined;
      }

      case ClaudeHookEvents.POST_TOOL_USE: {
        return input.tool_name === ClaudeHookEvents.SEND_MESSAGE_TOOL
          ? EventHook.mapSend({ input })
          : { kind: EventKinds.TOOL_TICK, summary: EventConstants.TOOL_TICK_LABEL };
      }

      default: {
        return undefined;
      }
    }
  }

  /**
   * Who a message went to, without where. A name stays as it is; an address with a path (`uds:/run/user/1000/cc-socks/3326301.sock`)
   * keeps its scheme and the last part of the path, so no folder of the machine is logged.
   */
  private static recipientOf(opts: { to: string }): string {
    if (!/[\\/]/.test(opts.to)) {
      return opts.to;
    }

    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(opts.to)?.[1];
    const last =
      opts.to
        .split(/[\\/]/)
        .filter((part) => part !== '')
        .pop() ?? '';

    return scheme === undefined ? last : `${scheme}:${last}`;
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
      summary: label === '' ? EventConstants.MESSAGE_SENT_LABEL : label,
      ...(recipient === '' ? {} : { ref: `to:${EventHook.recipientOf({ to: recipient })}` }),
      flowText: message,
    };
  }

  /**
   * Whether this session may write a tick now: the first call of each window creates the window's stamp and wins; a
   * call that finds the stamp already there loses. `wx` makes that one step, so calls at the same instant cannot both win.
   */
  private static takeTick(opts: { root: string; session: string; now: number }): boolean {
    const folder = join(opts.root, EventConstants.TICK_FOLDER);
    const window = Math.floor(opts.now / (EventConstants.TICK_SECONDS * 1000));
    const stamp = join(folder, `${opts.session.replace(/[^\w-]/g, '_') || 'session'}.${window}`);

    mkdirSync(folder, { recursive: true });

    try {
      writeFileSync(stamp, '', { flag: 'wx' });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        return false;
      }

      throw error;
    }

    for (const name of readdirSync(folder)) {
      if (Number(name.slice(name.lastIndexOf('.') + 1)) < window) {
        rmSync(join(folder, name), { force: true });
      }
    }

    return true;
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

    if (
      mapped.kind === EventKinds.TOOL_TICK &&
      !EventHook.takeTick({
        root: opts.root,
        session: text({ value: opts.input.session_id }),
        now: opts.now ?? Date.now(),
      })
    ) {
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
      ...(mapped.notification === undefined ? {} : { notification: mapped.notification }),
      ...(mapped.model === undefined ? {} : { model: mapped.model }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });

    EventLog.append({ dir: EventSettings.dirOf({ root: opts.root, settings }), event });

    return event;
  }
}
