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
import type { IEvent, TEventKind, TEventStatus } from './common/index.ts';
import { EventActor } from './actor.ts';
import { EventFlow } from './flow.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';

const USAGE = `usage: vulcan event add ${EventFlags.KIND} <kind> ${EventFlags.SUMMARY} <text> [${EventFlags.FLOW} F-n] [${EventFlags.REF} <ref>] [${EventFlags.STATUS} <${[...EventStatuses.SCHEME_SET].join('|')}>] [${EventFlags.ACTOR} <name>] [${EventFlags.DIR} <folder>]
       vulcan event tail [${EventFlags.SINCE} <time>] [${EventFlags.JSON}] [${EventFlags.DIR} <folder>]
kinds: ${[...EventKinds.SCHEME_SET].join(', ')}`;

type TFlagValues = Record<string, string>;

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
      ? EventCommand.add({ cwd: opts.cwd, values: parsed.values })
      : EventCommand.tail({ cwd: opts.cwd, values: parsed.values, json: parsed.json });
  }

  /** Flags with a value, and `--json`; `undefined` for anything else (the router has already refused unknown flags). */
  private static parse(opts: {
    args: string[];
  }): { values: TFlagValues; json: boolean } | undefined {
    const values: TFlagValues = {};
    let json = false;

    for (let index = 0; index < opts.args.length; index++) {
      const arg = opts.args[index];

      if (arg === EventFlags.JSON) {
        json = true;
        continue;
      }

      const value = opts.args[index + 1];

      if (!arg.startsWith('--') || value === undefined || Object.hasOwn(values, arg)) {
        return undefined;
      }

      values[arg] = value;
      index++;
    }

    return { values, json };
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

  private static add(opts: { cwd: string; values: TFlagValues }): number {
    const { values } = opts;
    const kind = values[EventFlags.KIND];
    const summary = values[EventFlags.SUMMARY];
    const flow = values[EventFlags.FLOW];

    if (kind === undefined || !EventKinds.isValid(kind)) {
      process.stderr.write(
        `event: ${EventFlags.KIND} must be one of ${[...EventKinds.SCHEME_SET].join(', ')}\n`,
      );

      return ExitCodes.USAGE;
    }

    if (summary === undefined || summary.trim() === '') {
      process.stderr.write(`event: ${EventFlags.SUMMARY} needs a short text\n`);

      return ExitCodes.USAGE;
    }

    if (flow !== undefined && !EventFlow.isValid({ flow })) {
      process.stderr.write(`event: ${EventFlags.FLOW} must look like F-12, got '${flow}'\n`);

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

    const flowId = flow ?? EventFlow.fromBranch({ cwd: opts.cwd });
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
    });

    try {
      EventLog.append({ dir: EventCommand.dirOf(opts), event });
    } catch (error) {
      process.stderr.write(
        `event: cannot write the log in ${EventCommand.dirOf(opts)}: ${error instanceof Error ? error.message : String(error)}\n`,
      );

      return ExitCodes.FAILURE;
    }

    process.stdout.write(`${event.id}\n`);

    return ExitCodes.OK;
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
