import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventKinds, EventSources } from './common/index.ts';
import type { IEvent, IEventMark, IEventUsage, TIsOver } from './common/index.ts';
import { EventActor } from './actor.ts';
import { FlowSteps } from './flow-steps.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';

/** The four counts of one iteration or one message. */
interface ITokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const NEWLINE = 0x0a;
const ASSISTANT = '"type":"assistant"';
const CHUNK = 1024 * 1024;

const countOf = (opts: { value: unknown }): number =>
  typeof opts.value === 'number' && Number.isFinite(opts.value) && opts.value > 0
    ? Math.floor(opts.value)
    : 0;

/**
 * The tokens a Claude Code session or subagent used, read from its transcript and written to the log as `usage` lines:
 * numbers and a model, never a price. The meter reads only the new part of the transcript since the mark kept on the last
 * `usage` line of that transcript (the byte after the last whole line, and the last message counted), so nothing is counted
 * twice and nothing is stored apart from the log. Of every assistant line it reads `message.id`, `message.model` and the
 * four counts of `message.usage` and of each of its `iterations`; the conversation itself is never kept.
 *
 * Counting rules, from real transcripts: one API message is written as several lines that repeat the same usage, so a
 * `message.id` is counted once; `iterations` hold the truth (an `advisor_message` iteration carries its own model and tokens
 * that the top-level counts leave out), so every iteration is summed under its own model, and the top-level counts are used
 * only when a message has no iterations.
 */
export class UsageMeter {
  /** The tokens in the part of a transcript from `offset`, by model, and the mark to continue from. Pure of the log. */
  static tail(opts: { file: string; offset: number; skipMessage?: string }): {
    byModel: Map<string, ITokens>;
    mark: IEventMark;
  } {
    const size = statSync(opts.file).size;
    const start = opts.offset > size ? 0 : opts.offset;
    const byModel = new Map<string, ITokens>();
    const counted = new Set<string>();
    let skipping = opts.offset > size ? undefined : opts.skipMessage;
    let last = opts.offset > size ? undefined : opts.skipMessage;
    let position = start;
    const descriptor = openSync(opts.file, 'r');

    try {
      let carry = Buffer.alloc(0);

      while (position < size) {
        const buffer = Buffer.alloc(Math.min(CHUNK, size - position));
        const read = readSync(descriptor, buffer, 0, buffer.length, position);

        if (read === 0) {
          break;
        }

        position += read;

        const joined = Buffer.concat([carry, buffer.subarray(0, read)]);
        const end = joined.lastIndexOf(NEWLINE);

        if (end < 0) {
          carry = joined;
          continue;
        }

        // Only whole lines are read: what follows the last newline is a line still being written.
        carry = joined.subarray(end + 1);

        for (const line of joined.subarray(0, end).toString('utf8').split('\n')) {
          const message = UsageMeter.messageOf({ line });

          if (message === undefined) {
            continue;
          }

          last = message.id;

          if (skipping === message.id) {
            continue;
          }

          skipping = undefined;

          if (counted.has(message.id)) {
            continue;
          }

          counted.add(message.id);

          for (const [model, tokens] of message.byModel) {
            const total = byModel.get(model) ?? {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            };

            total.input += tokens.input;
            total.output += tokens.output;
            total.cacheRead += tokens.cacheRead;
            total.cacheWrite += tokens.cacheWrite;
            byModel.set(model, total);
          }
        }
      }

      // The mark is the byte after the last whole line: the carried part was not read.
      const offset = position - carry.length;

      return { byModel, mark: { offset, ...(last === undefined ? {} : { message: last }) } };
    } finally {
      closeSync(descriptor);
    }
  }

  /** The id and the tokens of one transcript line, by model; `undefined` when it is not an assistant message with usage. */
  private static messageOf(opts: {
    line: string;
  }): { id: string; byModel: Map<string, ITokens> } | undefined {
    // A cheap test first: most lines of a transcript are tool results and user text, and are never parsed.
    if (!opts.line.includes(ASSISTANT)) {
      return undefined;
    }

    let value: unknown;

    try {
      value = JSON.parse(opts.line);
    } catch {
      return undefined;
    }

    const message = RecordValue.isRecord(value) ? value.message : undefined;
    const usage = RecordValue.isRecord(message) ? message.usage : undefined;

    if (
      !RecordValue.isRecord(value) ||
      value.type !== 'assistant' ||
      !RecordValue.isRecord(message) ||
      !RecordValue.isRecord(usage) ||
      typeof message.id !== 'string'
    ) {
      return undefined;
    }

    const model = typeof message.model === 'string' ? message.model : EventConstants.USAGE_NO_MODEL;
    const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
    const parts: { model: string; source: unknown }[] =
      iterations.length === 0
        ? [{ model, source: usage }]
        : iterations.map((iteration: unknown) => ({
            model:
              RecordValue.isRecord(iteration) && typeof iteration.model === 'string'
                ? iteration.model
                : model,
            source: iteration,
          }));
    const byModel = new Map<string, ITokens>();

    for (const part of parts) {
      if (!RecordValue.isRecord(part.source)) {
        continue;
      }

      const total = byModel.get(part.model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

      total.input += countOf({ value: part.source.input_tokens });
      total.output += countOf({ value: part.source.output_tokens });
      total.cacheRead += countOf({ value: part.source.cache_read_input_tokens });
      total.cacheWrite += countOf({ value: part.source.cache_creation_input_tokens });
      byModel.set(part.model, total);
    }

    return { id: message.id, byModel };
  }

  /**
   * Records the new tokens of one transcript as `usage` lines (one per model) on `flowId`, or on no flow. The mark comes
   * from the log; a transcript with no mark is read from its start up to `USAGE_FIRST_READ_MAX`, and a longer one is
   * only marked at its end (its earlier tokens are not counted: a known gap for a session that began before the hook).
   */
  static record(opts: {
    dir: string;
    file: string;
    ref: string;
    actor: string;
    flowId?: string;
    agent?: string;
    now?: number;
  }): IEvent[] {
    if (!existsSync(opts.file)) {
      return [];
    }

    const known = EventLog.read({
      dir: opts.dir,
      since: (opts.now ?? Date.now()) - EventConstants.USAGE_MARK_DAYS * EventConstants.DAY_MS,
    }).events;
    const before = known.findLast(
      (event) =>
        event.kind === EventKinds.USAGE && event.ref === opts.ref && event.mark !== undefined,
    )?.mark;
    if (before === undefined && statSync(opts.file).size > EventConstants.USAGE_FIRST_READ_MAX) {
      const event = UsageMeter.build({
        ...opts,
        usage: {
          model: EventConstants.USAGE_NO_MODEL,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        mark: { offset: statSync(opts.file).size },
      });

      EventLog.append({ dir: opts.dir, event });

      return [event];
    }

    const read = UsageMeter.tail({
      file: opts.file,
      offset: before?.offset ?? 0,
      ...(before?.message === undefined ? {} : { skipMessage: before.message }),
    });
    const written: IEvent[] = [];

    for (const [model, tokens] of read.byModel) {
      if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0) {
        continue;
      }

      const event = UsageMeter.build({
        ...opts,
        usage: {
          model,
          ...(opts.agent === undefined ? {} : { agent: opts.agent }),
          ...tokens,
        },
        mark: read.mark,
      });

      EventLog.append({ dir: opts.dir, event });
      written.push(event);
    }

    return written;
  }

  private static build(opts: {
    actor: string;
    ref: string;
    flowId?: string;
    usage: IEventUsage;
    mark: IEventMark;
    now?: number;
  }): IEvent {
    return EventLog.build({
      kind: EventKinds.USAGE,
      summary: EventConstants.USAGE_LABEL,
      actor: opts.actor,
      source: EventSources.CLAUDE_HOOK,
      ref: opts.ref,
      usage: opts.usage,
      mark: opts.mark,
      ...(opts.flowId === undefined ? {} : { flowId: opts.flowId }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
  }

  /**
   * The tokens of a session since its last mark, from a `Stop` payload: the session's transcript, on the flow of the
   * branch or the one the session last opened (none: the line has no flow). Nothing with `events.log` off or without a
   * transcript path; it throws nothing the caller must handle beyond the read of the file.
   */
  static recordSession(opts: {
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    now?: number;
  }): IEvent[] {
    const settings = EventSettings.read({ root: opts.root });
    const { input } = opts;
    const file = typeof input.transcript_path === 'string' ? input.transcript_path : '';
    const session = typeof input.session_id === 'string' ? input.session_id : '';

    if (!settings.log || file === '' || session === '') {
      return [];
    }

    return UsageMeter.recordFor({ ...opts, settings, file, ref: `transcript:${session}` });
  }

  /** The tokens of a subagent since its last mark, from a `SubagentStop` payload, on its parent session's flow. */
  static recordSubagent(opts: {
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    now?: number;
  }): IEvent[] {
    const settings = EventSettings.read({ root: opts.root });
    const { input } = opts;
    const file = typeof input.agent_transcript_path === 'string' ? input.agent_transcript_path : '';
    const agentId = typeof input.agent_id === 'string' ? input.agent_id : '';

    if (!settings.log || file === '' || agentId === '') {
      return [];
    }

    return UsageMeter.recordFor({
      ...opts,
      settings,
      file,
      ref: `transcript:${agentId}`,
      ...(typeof input.agent_type === 'string' && input.agent_type !== ''
        ? { agent: input.agent_type }
        : {}),
    });
  }

  private static recordFor(opts: {
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    settings: ReturnType<typeof EventSettings.read>;
    file: string;
    ref: string;
    agent?: string;
    now?: number;
  }): IEvent[] {
    const dir = EventSettings.dirOf({ root: opts.root, settings: opts.settings });
    const actor = EventActor.resolve({
      sessionId: typeof opts.input.session_id === 'string' ? opts.input.session_id : undefined,
      env: opts.env,
    });
    const key = EventSettings.keyOf({ root: opts.root });
    const known = EventLog.read({
      dir,
      since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
    }).events;
    const flowId = FlowSteps.flowOf({
      events: known,
      cwd: typeof opts.input.cwd === 'string' && opts.input.cwd !== '' ? opts.input.cwd : opts.root,
      actor,
      isOver: (id) => opts.isOver({ events: known, flowId: id, key }),
    });

    return UsageMeter.record({
      dir,
      file: opts.file,
      ref: opts.ref,
      actor,
      ...(flowId === undefined ? {} : { flowId }),
      ...(opts.agent === undefined ? {} : { agent: opts.agent }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
  }
}
