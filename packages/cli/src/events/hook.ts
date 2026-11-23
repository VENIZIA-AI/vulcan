import { RecordValue } from '../common/record.ts';
import {
  ClaudeHookEvents,
  EventConstants,
  EventKinds,
  EventSources,
  GitActivities,
} from './common/index.ts';
import type { IEvent, IHookEvent, TEventKind, TGitActivity, TIsOver } from './common/index.ts';
import { EventActor } from './actor.ts';
import { EventFlow } from './flow.ts';
import { FlowSteps } from './flow-steps.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';
import { EventText } from './text.ts';

const text = (opts: { value: unknown }): string =>
  typeof opts.value === 'string' ? opts.value : '';

/** What Claude Code tells a hook, turned into log lines. It reads names and short labels, never bodies. */
export class EventHook {
  /**
   * The event a payload stands for, or `undefined` when the payload is not one to log. Only these fields are
   * read: `source` and `model` of a session start, `agent_type` and `agent_id` of a subagent stop,
   * `notification_type` and `title` of a notification, and `to` and `summary` of a SendMessage call (the label the
   * sender gave it, or a fixed one). A turn that ends and a tool that is used are not events.
   * `last_assistant_message`, the text of a message, `tool_response`, every command and every other part of a tool's
   * input stay unread. The one exception is the step text of a `TodoWrite` call (`mirrorTodos`): the `content` and
   * `status` of each task, cleaned and redacted like every text of the log.
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
        return EventHook.mapSend({ input });
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
   * The task list of a `TodoWrite` call merged into the steps of the flow, never replacing them: a task that is not yet
   * a step is added, a completed one marks its step done, and nothing is removed or reopened, so what an agent wrote
   * with `vulcan event step` stays. The flow is the branch's at the payload's `cwd`, else the one this session last
   * opened or updated, both only within `MIRROR_DAYS` of the log; a flow that is over, a flow with no flow line yet, an
   * actor that is not known and a call of a subagent (its payload carries `agent_id`, and it would write its own list
   * over its parent's flow) write nothing. The rest of the last flow line is copied forward. A call that changes no
   * step writes nothing, so a burst of calls is one line. Two writers of one flow at the same moment can lose one
   * change: the log has no lock, and the next call restates the whole merge.
   */
  private static mirrorTodos(opts: {
    dir: string;
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    now?: number;
    isOver?: TIsOver;
  }): IEvent | undefined {
    const call = opts.input.tool_input;
    const todos = RecordValue.isRecord(call) && Array.isArray(call.todos) ? call.todos : [];
    const tasks = EventText.items({
      items: todos.flatMap((todo: unknown) =>
        RecordValue.isRecord(todo)
          ? [{ text: text({ value: todo.content }), done: todo.status === 'completed' }]
          : [],
      ),
      max: EventConstants.ITEM_TEXT_MAX,
      count: EventConstants.ITEM_COUNT_MAX,
    });
    const actor = EventActor.resolve({
      sessionId: text({ value: opts.input.session_id }),
      env: opts.env,
    });

    // No checker, no write: a flow that may be over is never written to.
    if (
      opts.isOver === undefined ||
      tasks.length === 0 ||
      text({ value: opts.input.agent_id }) !== '' ||
      actor === EventConstants.UNKNOWN_ACTOR
    ) {
      return undefined;
    }

    const key = EventSettings.keyOf({ root: opts.root });
    const known = EventLog.read({
      dir: opts.dir,
      since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
    }).events;
    const flowId =
      EventFlow.fromBranch({ cwd: text({ value: opts.input.cwd }) || opts.root }) ??
      FlowSteps.lastOpenedBy({
        events: known,
        actor,
        isOver: (id) => opts.isOver?.({ events: known, flowId: id, key }) ?? true,
      });
    const last =
      flowId === undefined ? undefined : FlowSteps.lastLine({ events: known, flowId, key });

    if (last === undefined || opts.isOver({ events: known, flowId: flowId ?? '', key })) {
      return undefined;
    }

    const steps = FlowSteps.merged({ steps: last.steps ?? [], tasks });

    if (FlowSteps.isSame({ first: steps, second: last.steps ?? [] })) {
      return undefined;
    }

    const event = FlowSteps.continued({
      last,
      steps,
      actor,
      source: EventSources.CLAUDE_HOOK,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });

    EventLog.append({ dir: opts.dir, event });

    return event;
  }

  /**
   * Whether the tool result says the call failed or was interrupted. Claude Code runs a failed tool through
   * `PostToolUseFailure`, so this is only a second guard for a result that carries a flag or an exit code.
   */
  private static hasFailed(opts: { input: Record<string, unknown> }): boolean {
    const result = opts.input.tool_response;

    if (!RecordValue.isRecord(result)) {
      return false;
    }

    const code = result.exit_code ?? result.exitCode;

    return (
      result.interrupted === true ||
      result.success === false ||
      result.is_error === true ||
      (typeof code === 'number' && code !== 0)
    );
  }

  /**
   * A shell call that committed, opened a pull request or merged one: a line of the fixed label for it, on the flow of the
   * branch, else the one this session last opened or updated (none when neither is found). The command itself is never
   * read here; the script gives only its class, and every other shell call writes nothing.
   */
  private static logActivity(opts: {
    dir: string;
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    now?: number;
    activity?: TGitActivity;
    isOver?: TIsOver;
  }): IEvent | undefined {
    const labels: Record<TGitActivity, { kind: TEventKind; summary: string }> = {
      [GitActivities.COMMIT]: { kind: EventKinds.COMMIT, summary: EventConstants.COMMIT_LABEL },
      [GitActivities.PR_OPEN]: { kind: EventKinds.PR, summary: EventConstants.PR_OPEN_LABEL },
      [GitActivities.PR_MERGE]: { kind: EventKinds.PR, summary: EventConstants.PR_MERGE_LABEL },
    };
    const label = opts.activity === undefined ? undefined : labels[opts.activity];

    // A call that failed or was interrupted did not commit, open or merge anything.
    if (
      label === undefined ||
      opts.isOver === undefined ||
      EventHook.hasFailed({ input: opts.input })
    ) {
      return undefined;
    }

    const actor = EventActor.resolve({
      sessionId: text({ value: opts.input.session_id }),
      env: opts.env,
    });
    const key = EventSettings.keyOf({ root: opts.root });
    const known = EventLog.read({
      dir: opts.dir,
      since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
    }).events;
    const { isOver } = opts;
    const flowId =
      EventFlow.fromBranch({ cwd: text({ value: opts.input.cwd }) || opts.root }) ??
      FlowSteps.lastOpenedBy({
        events: known,
        actor,
        isOver: (id) => isOver({ events: known, flowId: id, key }),
      });

    // Work on a flow that is over is not logged on it, as for the task list.
    if (flowId !== undefined && isOver({ events: known, flowId, key })) {
      return undefined;
    }

    const event = EventLog.build({
      kind: label.kind,
      summary: label.summary,
      actor,
      source: EventSources.CLAUDE_HOOK,
      ...(flowId === undefined ? {} : { flowId }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });

    EventLog.append({ dir: opts.dir, event });

    return event;
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
    /** `FlowState.isOver`, given by the script only for a `TodoWrite` call or a commit, a pull request: it reaches the board, which the other calls do not load. */
    isOver?: TIsOver;
    /** What a `Bash` call did, as `GitActivity.classify` says it (the script reads the command and passes only the class). */
    activity?: TGitActivity;
  }): IEvent | undefined {
    const settings = EventSettings.read({ root: opts.root });

    if (!settings.log) {
      return undefined;
    }

    if (RecordValue.isRecord(opts.input) && opts.input.tool_name === ClaudeHookEvents.BASH_TOOL) {
      return EventHook.logActivity({
        dir: EventSettings.dirOf({ root: opts.root, settings }),
        root: opts.root,
        input: opts.input,
        env: opts.env,
        ...(opts.now === undefined ? {} : { now: opts.now }),
        ...(opts.activity === undefined ? {} : { activity: opts.activity }),
        ...(opts.isOver === undefined ? {} : { isOver: opts.isOver }),
      });
    }

    if (RecordValue.isRecord(opts.input) && opts.input.tool_name === ClaudeHookEvents.TODO_TOOL) {
      return EventHook.mirrorTodos({
        dir: EventSettings.dirOf({ root: opts.root, settings }),
        root: opts.root,
        input: opts.input,
        env: opts.env,
        ...(opts.now === undefined ? {} : { now: opts.now }),
        ...(opts.isOver === undefined ? {} : { isOver: opts.isOver }),
      });
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
      ...(mapped.notification === undefined ? {} : { notification: mapped.notification }),
      ...(mapped.model === undefined ? {} : { model: mapped.model }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });

    EventLog.append({ dir: EventSettings.dirOf({ root: opts.root, settings }), event });

    return event;
  }
}
