import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import {
  EventConstants,
  EventFlags,
  EventKinds,
  EventSources,
  EventStatuses,
  EventSubcommands,
} from './common/index.ts';
import type { IEvent, IEventItem, TEventKind, TEventStatus } from './common/index.ts';
import { EventActor } from './actor.ts';
import { EventFlow } from './flow.ts';
import { FlowId } from './flow-id.ts';
import { ProjectKey } from './project-key.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';

const USAGE = `usage: vulcan event add ${EventFlags.KIND} <kind> ${EventFlags.SUMMARY} <text> [${EventFlags.FLOW} <flow id>] [${EventFlags.REF} <ref>] [${EventFlags.STATUS} <${[...EventStatuses.SCHEME_SET].join('|')}>] [${EventFlags.ACTOR} <name>] [${EventFlags.DIR} <folder>]
       vulcan event add ${EventFlags.KIND} ${EventKinds.FLOW} [${EventFlags.FLOW} <flow id>] ${EventFlags.TITLE} <text> [${EventFlags.WHY} <text>] [${EventFlags.CONTEXT} <text>] [${EventFlags.NEXT} <text>] [${EventFlags.ACTOR} <name>] [${EventFlags.DIR} <folder>]
       vulcan event tail [${EventFlags.SINCE} <time>] [${EventFlags.JSON}] [${EventFlags.DIR} <folder>]
kinds: ${[...EventKinds.SCHEME_SET].join(', ')}
A flow line without ${EventFlags.FLOW} makes a new flow and prints its id (VULZ-<project.key>-<number>); give that id to every other line of the flow. Ids are never typed by hand.`;

type TFlagValues = Record<string, string>;

/** A flag that may be given again, and the order of the given ones matters: the lists of a flow line. */
interface IListFlag {
  flag: string;
  value: string;
}

const LIST_FLAGS = new Set<string>([
  EventFlags.STEP,
  EventFlags.STEP_DONE,
  EventFlags.CHECK,
  EventFlags.CHECK_DONE,
  EventFlags.APP,
]);

/** `vulcan event`: write a line to the agent event log, or read the log. */
export class EventCommand {
  static async run(opts: ICommandContext): Promise<number> {
    const [subcommand, ...rest] = opts.args;
    const parsed = EventCommand.parse({ args: rest });

    if (
      parsed === undefined ||
      (subcommand !== EventSubcommands.ADD && subcommand !== EventSubcommands.TAIL)
    ) {
      process.stderr.write(`event: ${USAGE}\n`);

      return ExitCodes.USAGE;
    }

    return subcommand === EventSubcommands.ADD
      ? EventCommand.add({ cwd: opts.cwd, values: parsed.values, lists: parsed.lists })
      : EventCommand.tail({ cwd: opts.cwd, values: parsed.values, json: parsed.json });
  }

  /** Flags with a value, and `--json`; `undefined` for anything else (the router has already refused unknown flags). */
  private static parse(opts: {
    args: string[];
  }): { values: TFlagValues; lists: IListFlag[]; json: boolean } | undefined {
    const values: TFlagValues = {};
    const lists: IListFlag[] = [];
    let json = false;

    for (let index = 0; index < opts.args.length; index++) {
      const arg = opts.args[index];

      if (arg === EventFlags.JSON) {
        json = true;
        continue;
      }

      const value = opts.args[index + 1];

      if (
        !arg.startsWith('--') ||
        value === undefined ||
        (!LIST_FLAGS.has(arg) && Object.hasOwn(values, arg))
      ) {
        return undefined;
      }

      if (LIST_FLAGS.has(arg)) {
        lists.push({ flag: arg, value });
      } else {
        values[arg] = value;
      }

      index++;
    }

    return { values, lists, json };
  }

  /** The folder to use: `--dir`, else the manifest's `events.dir`, else the project's own. */
  private static dirOf(opts: { cwd: string; values: TFlagValues }): string {
    return EventSettings.dirOf({
      root: EventSettings.rootOf({ cwd: opts.cwd }),
      ...(opts.values[EventFlags.DIR] === undefined
        ? {}
        : { dir: resolve(opts.cwd, opts.values[EventFlags.DIR]) }),
    });
  }

  private static add(opts: { cwd: string; values: TFlagValues; lists: IListFlag[] }): number {
    const { values } = opts;
    const kind = values[EventFlags.KIND];
    const isFlow = kind === EventKinds.FLOW;
    // A flow line is named by its title: the title is its summary, and `--summary` is not a second way to say it.
    const summary = isFlow ? values[EventFlags.TITLE] : values[EventFlags.SUMMARY];
    const flow = values[EventFlags.FLOW];

    if (kind === undefined || !EventKinds.isValid(kind)) {
      process.stderr.write(
        `event: ${EventFlags.KIND} must be one of ${[...EventKinds.SCHEME_SET].join(', ')}\n`,
      );

      return ExitCodes.USAGE;
    }

    if (summary === undefined || summary.trim() === '') {
      process.stderr.write(
        `event: ${isFlow ? EventFlags.TITLE : EventFlags.SUMMARY} needs a short text\n`,
      );

      return ExitCodes.USAGE;
    }

    if (
      isFlow
        ? values[EventFlags.SUMMARY] !== undefined
        : values[EventFlags.TITLE] !== undefined ||
          values[EventFlags.WHY] !== undefined ||
          values[EventFlags.CONTEXT] !== undefined ||
          values[EventFlags.NEXT] !== undefined
    ) {
      process.stderr.write(
        isFlow
          ? `event: a flow line takes ${EventFlags.TITLE}, not ${EventFlags.SUMMARY}\n`
          : `event: ${EventFlags.TITLE}, ${EventFlags.WHY}, ${EventFlags.CONTEXT} and ${EventFlags.NEXT} belong to a flow line only\n`,
      );

      return ExitCodes.USAGE;
    }

    const items = EventCommand.itemsOf({ lists: opts.lists, due: values[EventFlags.DUE], isFlow });

    if (!items.ok) {
      process.stderr.write(`event: ${items.message}\n`);

      return ExitCodes.USAGE;
    }

    for (const flag of [EventFlags.CONTEXT, EventFlags.NEXT]) {
      if (values[flag] !== undefined && values[flag].trim() === '') {
        process.stderr.write(`event: ${flag} needs a short text, or leave it out\n`);

        return ExitCodes.USAGE;
      }
    }

    if (flow !== undefined && !EventFlow.isValid({ flow })) {
      process.stderr.write(
        `event: ${EventFlags.FLOW} must look like VULZ-ACME-12 (the id the command printed), got '${flow}'\n`,
      );

      return ExitCodes.USAGE;
    }

    const status = values[EventFlags.STATUS];

    // A decision says which way it went; no other line has a status.
    if (
      kind === EventKinds.DECISION
        ? status === undefined || !EventStatuses.isValid(status)
        : status !== undefined
    ) {
      process.stderr.write(
        kind === EventKinds.DECISION
          ? `event: a decision needs ${EventFlags.STATUS} <${[...EventStatuses.SCHEME_SET].join('|')}>\n`
          : `event: ${EventFlags.STATUS} belongs to a decision only\n`,
      );

      return ExitCodes.USAGE;
    }

    const dir = EventCommand.dirOf(opts);
    const key = EventSettings.keyOf({ root: EventSettings.rootOf({ cwd: opts.cwd }) });
    const known = EventLog.read({ dir }).events;
    const named = flow ?? EventFlow.fromBranch({ cwd: opts.cwd });
    const placed = EventCommand.flowOf({
      flow: named,
      known,
      key,
      isFlow,
      dir,
      explicit: flow !== undefined,
    });

    if (!placed.ok) {
      return placed.code;
    }

    const { flowId } = placed;
    const actor =
      values[EventFlags.ACTOR] === undefined
        ? EventActor.resolve({
            sessionId: process.env[EventConstants.SESSION_ENV],
            env: process.env,
          })
        : EventActor.clean({ text: values[EventFlags.ACTOR] });
    const event: IEvent = EventLog.build({
      kind: kind as TEventKind,
      summary,
      actor: actor === '' ? EventConstants.UNKNOWN_ACTOR : actor,
      source: EventSources.CLI,
      ...(flowId === undefined ? {} : { flowId }),
      ...(values[EventFlags.REF] === undefined ? {} : { ref: values[EventFlags.REF] }),
      ...(status === undefined ? {} : { status: status as TEventStatus }),
      ...(values[EventFlags.WHY] === undefined ? {} : { why: values[EventFlags.WHY] }),
      ...(values[EventFlags.CONTEXT] === undefined ? {} : { context: values[EventFlags.CONTEXT] }),
      ...(values[EventFlags.NEXT] === undefined ? {} : { next: values[EventFlags.NEXT] }),
      steps: items.steps,
      checks: items.checks,
      apps: items.apps,
      ...(values[EventFlags.DUE] === undefined ? {} : { due: values[EventFlags.DUE] }),
    });

    try {
      EventLog.append({ dir, event });
    } catch (error) {
      process.stderr.write(
        `event: cannot write the log in ${dir}: ${error instanceof Error ? error.message : String(error)}\n`,
      );

      return ExitCodes.FAILURE;
    }

    process.stdout.write(
      `${isFlow && flow === undefined && flowId !== undefined ? flowId : event.id}\n`,
    );

    return ExitCodes.OK;
  }

  /**
   * The lists of a flow line from the flags, in the order given, and the due date. They belong to a flow line only; a text
   * that is empty or over its limit, too many of them, or a due date that is not a day, is refused (the other texts are
   * cut, but a list an agent restates in full must not lose a word without a word said).
   */
  private static itemsOf(opts: {
    lists: IListFlag[];
    due: string | undefined;
    isFlow: boolean;
  }):
    | { ok: true; steps: IEventItem[]; checks: IEventItem[]; apps: string[] }
    | { ok: false; message: string } {
    const steps: IEventItem[] = [];
    const checks: IEventItem[] = [];
    const apps: string[] = [];

    if (!opts.isFlow && (opts.lists.length > 0 || opts.due !== undefined)) {
      return {
        ok: false,
        message: `${[...LIST_FLAGS, EventFlags.DUE].join(', ')} belong to a flow line only`,
      };
    }

    for (const { flag, value } of opts.lists) {
      const isApp = flag === EventFlags.APP;
      const max = isApp ? EventConstants.APP_TEXT_MAX : EventConstants.ITEM_TEXT_MAX;

      if (value.trim() === '' || Array.from(value).length > max) {
        return { ok: false, message: `${flag} needs a text of 1 to ${max} characters` };
      }

      if (flag === EventFlags.STEP || flag === EventFlags.STEP_DONE) {
        steps.push({ text: value, done: flag === EventFlags.STEP_DONE });
      } else if (flag === EventFlags.CHECK || flag === EventFlags.CHECK_DONE) {
        checks.push({ text: value, done: flag === EventFlags.CHECK_DONE });
      } else {
        apps.push(value);
      }
    }

    for (const [flag, count, limit] of [
      [`${EventFlags.STEP}/${EventFlags.STEP_DONE}`, steps.length, EventConstants.ITEM_COUNT_MAX],
      [
        `${EventFlags.CHECK}/${EventFlags.CHECK_DONE}`,
        checks.length,
        EventConstants.ITEM_COUNT_MAX,
      ],
      [EventFlags.APP, apps.length, EventConstants.APP_COUNT_MAX],
    ] as const) {
      if (count > limit) {
        return { ok: false, message: `at most ${limit} of ${flag}, got ${count}` };
      }
    }

    if (opts.due !== undefined && !EventCommand.isDay({ value: opts.due })) {
      return {
        ok: false,
        message: `${EventFlags.DUE} must be a day such as 2026-11-08, got '${opts.due}'`,
      };
    }

    return { ok: true, steps, checks, apps };
  }

  /** `2026-11-08`, and a day that exists: `2026-02-30` is not one. */
  private static isDay(opts: { value: string }): boolean {
    const time = Date.parse(`${opts.value}T00:00:00Z`);

    return (
      EventConstants.DUE_PATTERN.test(opts.value) &&
      Number.isFinite(time) &&
      new Date(time).toISOString().startsWith(opts.value)
    );
  }

  /**
   * The flow a line belongs to. A flow named with `--flow` must exist (an id is never made up by hand). A flow line that
   * names none either updates the flow of its branch, when the branch names one that exists and is not over, or starts a
   * new flow with the next number. The exit code comes back when the line cannot be written.
   */
  private static flowOf(opts: {
    flow: string | undefined;
    known: IEvent[];
    key: string | undefined;
    isFlow: boolean;
    dir: string;
    explicit: boolean;
  }): { ok: true; flowId: string | undefined } | { ok: false; code: number } {
    const { flow, known, key } = opts;

    // The flow of the branch is taken only while it is open: work on a merged or parked flow's branch is a new flow.
    if (
      flow !== undefined &&
      FlowId.exists({ events: known, id: flow, key }) &&
      (opts.explicit || !opts.isFlow || !FlowId.isClosed({ events: known, id: flow, key }))
    ) {
      return { ok: true, flowId: flow };
    }

    if (flow !== undefined && opts.explicit) {
      const recent = FlowId.recent({ events: known, key, count: EventConstants.FLOW_RECENT_COUNT });

      process.stderr.write(
        `event: no flow ${flow} in the log. ${recent.length === 0 ? 'The log has no flow yet' : `Recent flows: ${recent.join(', ')}`}. Make a new flow with: vulcan event add ${EventFlags.KIND} ${EventKinds.FLOW} ${EventFlags.TITLE} <text>\n`,
      );

      return { ok: false, code: ExitCodes.USAGE };
    }

    if (!opts.isFlow) {
      return { ok: true, flowId: flow };
    }

    if (key === undefined) {
      process.stderr.write(
        `event: the project has no key for its flows: set project.key in the config (${ProjectKey.MESSAGE}) and run vulcan sync\n`,
      );

      return { ok: false, code: ExitCodes.USAGE };
    }

    return { ok: true, flowId: FlowId.next({ dir: opts.dir, key }) };
  }

  private static tail(opts: { cwd: string; values: TFlagValues; json: boolean }): number {
    const { values } = opts;
    const since = EventCommand.sinceOf({ value: values[EventFlags.SINCE] });

    if (since === undefined) {
      process.stderr.write(
        `event: ${EventFlags.SINCE} needs a time such as 2026-11-03 or 2026-11-03T09:00:00Z\n`,
      );

      return ExitCodes.USAGE;
    }

    const dir = EventCommand.dirOf(opts);

    // A folder named on purpose that is not there is a typo; the default folder does not exist until the first write.
    if (
      values[EventFlags.DIR] !== undefined &&
      (!existsSync(dir) || !statSync(dir).isDirectory())
    ) {
      process.stderr.write(`event: ${dir} is not a folder\n`);

      return ExitCodes.USAGE;
    }

    const { events, skipped } = EventLog.read({ dir, since });

    for (const event of events) {
      process.stdout.write(
        opts.json
          ? `${JSON.stringify(event)}\n`
          : `${event.ts} ${event.kind.padEnd(13)} ${event.actor} ${event.flowId ?? '-'} ${event.summary}\n`,
      );
    }

    if (skipped > 0) {
      process.stderr.write(`event: skipped ${skipped} line(s) that are not events\n`);
    }

    return ExitCodes.OK;
  }

  /** The time to read from: the value, or 24 hours ago; `undefined` when the value is not a time. */
  private static sinceOf(opts: { value: string | undefined }): number | undefined {
    if (opts.value === undefined) {
      return Date.now() - EventConstants.DAY_MS;
    }

    const time = Date.parse(opts.value);

    return Number.isFinite(time) ? time : undefined;
  }
}
