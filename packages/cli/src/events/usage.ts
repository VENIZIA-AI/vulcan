import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventTypes, EventSources } from './common/index.ts';
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
/** How much of the start of a transcript is read to find its first timestamp. */
const HEAD = 64 * 1024;

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
  /**
   * The tokens in the part of a transcript from `offset`, by model, and the mark to continue from. Pure of the log.
   * `side` says whose lines count: `main` drops the lines of subagents (`isSidechain`), `sub` keeps only them, so a parent's
   * Stop never counts a subagent's tokens and the subagent's own stop counts them once. With `own` (a session id) the read
   * is of a transcript met for the first time or rewritten: only what comes at or after the first user line of that
   * session is counted, so history copied into the file (a fork, a resume that rewrites it) is not counted again.
   */
  static tail(opts: {
    file: string;
    offset: number;
    skipMessage?: string;
    size?: number;
    side?: 'main' | 'sub';
    own?: string;
  }): {
    byModel: Map<string, ITokens>;
    mark: IEventMark;
  } {
    const size = opts.size ?? statSync(opts.file).size;
    const start = opts.offset > size ? 0 : opts.offset;
    const side = opts.side ?? 'main';
    // One entry per message id, the largest count of each field over the lines that carry it.
    const counted = new Map<string, Map<string, ITokens>>();
    const held = new Map<string, Map<string, ITokens>>();
    let isStarted = opts.own === undefined;
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
          if (
            !isStarted &&
            opts.own !== undefined &&
            UsageMeter.isOwnStart({ line, own: opts.own })
          ) {
            isStarted = true;
            held.clear();
            continue;
          }

          const message = UsageMeter.messageOf({ line, side });

          if (message === undefined) {
            continue;
          }

          last = message.id;

          if (skipping === message.id) {
            continue;
          }

          skipping = undefined;

          const into = isStarted ? counted : held;
          const known = into.get(message.id);

          into.set(
            message.id,
            known === undefined
              ? message.byModel
              : UsageMeter.largest({ left: known, right: message.byModel }),
          );
        }
      }

      // A transcript with no first user line of its own (no session id on its lines) is counted whole.
      const messages = isStarted ? counted : new Map([...held, ...counted]);
      const byModel = new Map<string, ITokens>();

      for (const perModel of messages.values()) {
        for (const [model, tokens] of perModel) {
          const total = byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

          total.input += tokens.input;
          total.output += tokens.output;
          total.cacheRead += tokens.cacheRead;
          total.cacheWrite += tokens.cacheWrite;
          byModel.set(model, total);
        }
      }

      // The mark is the byte after the last whole line: the carried part was not read.
      const offset = position - carry.length;

      return { byModel, mark: { offset, ...(last === undefined ? {} : { message: last }) } };
    } finally {
      closeSync(descriptor);
    }
  }

  /** The larger of each count, per model: a message repeated over several lines is counted at its largest line, not its first. */
  private static largest(opts: {
    left: Map<string, ITokens>;
    right: Map<string, ITokens>;
  }): Map<string, ITokens> {
    const merged = new Map<string, ITokens>();

    for (const model of new Set([...opts.left.keys(), ...opts.right.keys()])) {
      const a = opts.left.get(model);
      const b = opts.right.get(model);

      merged.set(model, {
        input: Math.max(a?.input ?? 0, b?.input ?? 0),
        output: Math.max(a?.output ?? 0, b?.output ?? 0),
        cacheRead: Math.max(a?.cacheRead ?? 0, b?.cacheRead ?? 0),
        cacheWrite: Math.max(a?.cacheWrite ?? 0, b?.cacheWrite ?? 0),
      });
    }

    return merged;
  }

  /** Whether a line is the first user line of the session `own`, and not one copied from another (`forkedFrom`, or another session id). */
  private static isOwnStart(opts: { line: string; own: string }): boolean {
    if (!opts.line.includes('"type":"user"')) {
      return false;
    }

    try {
      const value: unknown = JSON.parse(opts.line);

      return (
        RecordValue.isRecord(value) &&
        value.type === 'user' &&
        value.sessionId === opts.own &&
        value.forkedFrom === undefined
      );
    } catch {
      return false;
    }
  }

  /** The timestamp of the first line of a transcript that has one, or `undefined`: where the session began. */
  static firstTimestamp(opts: { file: string }): number | undefined {
    const descriptor = openSync(opts.file, 'r');

    try {
      const buffer = Buffer.alloc(HEAD);
      const read = readSync(descriptor, buffer, 0, HEAD, 0);

      for (const line of buffer.subarray(0, read).toString('utf8').split('\n')) {
        try {
          const value: unknown = JSON.parse(line);
          const time =
            RecordValue.isRecord(value) && typeof value.timestamp === 'string'
              ? Date.parse(value.timestamp)
              : Number.NaN;

          if (Number.isFinite(time)) {
            return time;
          }
        } catch {
          // A line cut by the end of the head, or a line that is not JSON: the next one is tried.
        }
      }

      return undefined;
    } finally {
      closeSync(descriptor);
    }
  }

  /** The id and the tokens of one transcript line, by model; `undefined` when it is not an assistant message with usage, or is of the other side. */
  private static messageOf(opts: {
    line: string;
    side: 'main' | 'sub';
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
      (value.isSidechain === true) !== (opts.side === 'sub') ||
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
   * Records the new tokens of one transcript as `usage` lines (one per model) on `flowId`, or on no flow. `known` is the log
   * as the caller read it once, back over the retention window, so a mark is found however long the session sat idle. A
   * transcript with no mark is read from its start up to `USAGE_FIRST_READ_MAX` (counting only what is at or after the
   * first user line of `session`, so copied history is not counted); a longer one, and one whose first line is older than
   * the window (its marks were removed by the retention, and its earlier tokens were counted or are gone), is only marked at
   * its end. A file shorter than its mark was rewritten and is read the same way, as a first sight.
   */
  static record(opts: {
    dir: string;
    file: string;
    ref: string;
    actor: string;
    known: IEvent[];
    windowDays: number;
    session?: string;
    side?: 'main' | 'sub';
    flowId?: string;
    agent?: string;
    now?: number;
  }): IEvent[] {
    if (!existsSync(opts.file)) {
      return [];
    }

    const now = opts.now ?? Date.now();
    const size = statSync(opts.file).size;
    const found = opts.known.findLast(
      (event) =>
        event.type === EventTypes.USAGE && event.ref === opts.ref && event.mark !== undefined,
    )?.mark;
    const isFresh = found === undefined || found.offset > size;
    const began = isFresh ? UsageMeter.firstTimestamp({ file: opts.file }) : undefined;

    if (
      isFresh &&
      (size > EventConstants.USAGE_FIRST_READ_MAX ||
        (found === undefined &&
          began !== undefined &&
          began < now - opts.windowDays * EventConstants.DAY_MS))
    ) {
      const event = UsageMeter.build({
        ...opts,
        usage: {
          model: EventConstants.USAGE_NO_MODEL,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        mark: { offset: size },
      });

      EventLog.append({ dir: opts.dir, event });

      return [event];
    }

    const read = UsageMeter.tail({
      file: opts.file,
      size,
      offset: isFresh ? 0 : (found?.offset ?? 0),
      ...(isFresh || found?.message === undefined ? {} : { skipMessage: found.message }),
      ...(opts.side === undefined ? {} : { side: opts.side }),
      ...(isFresh && opts.session !== undefined ? { own: opts.session } : {}),
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
      type: EventTypes.USAGE,
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

    return UsageMeter.recordFor({
      ...opts,
      settings,
      file,
      ref: `transcript:${session}`,
      side: 'main',
      session,
    });
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
      side: 'sub',
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
    side: 'main' | 'sub';
    session?: string;
    agent?: string;
    now?: number;
  }): IEvent[] {
    const dir = EventSettings.dirOf({ root: opts.root, settings: opts.settings });
    const actor = EventActor.resolve({
      sessionId: typeof opts.input.session_id === 'string' ? opts.input.session_id : undefined,
      env: opts.env,
    });
    const key = EventSettings.keyOf({ root: opts.root });
    const now = opts.now ?? Date.now();
    const windowDays = opts.settings.maxAgeDays ?? EventConstants.DEFAULT_MAX_AGE_DAYS;
    // The log is read once, back over the retention window: the marks need all of it, the flow only the last days.
    const known = EventLog.read({ dir, since: now - windowDays * EventConstants.DAY_MS }).events;
    const recent = known.filter(
      (event) => Date.parse(event.ts) >= now - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
    );
    const flowId = FlowSteps.flowOf({
      events: recent,
      cwd: typeof opts.input.cwd === 'string' && opts.input.cwd !== '' ? opts.input.cwd : opts.root,
      actor,
      isOver: (id) => opts.isOver({ events: recent, flowId: id, key }),
    });

    return UsageMeter.record({
      dir,
      file: opts.file,
      ref: opts.ref,
      actor,
      known,
      windowDays,
      side: opts.side,
      ...(opts.session === undefined ? {} : { session: opts.session }),
      ...(flowId === undefined ? {} : { flowId }),
      ...(opts.agent === undefined ? {} : { agent: opts.agent }),
      now,
    });
  }
}
