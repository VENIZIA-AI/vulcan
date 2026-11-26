import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventTypes, EventSources } from './common/index.ts';
import type { IEvent, IEventMark, IEventUsage } from './common/index.ts';
import { EventActor } from './actor.ts';
import { EventFlow } from './flow.ts';
import { FlowSteps } from './flow-steps.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';

/** The four counts of one iteration or one message, and the thinking part of the output when the message says it. */
interface ITokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thinking?: number;
}

/** One transcript message as counted: its flow, when it was written, and its tokens by model. */
interface IMessage {
  flowId?: string;
  time?: number;
  byModel: Map<string, ITokens>;
}

/** The transcripts of a session's subagents, beside its own: `<session>/subagents/agent-<id>.jsonl`. */
const SUBAGENT_FILE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
/** A subagent's transcript written this recently is left to a later read: its own stop may be reading it now. */
const SUBAGENT_QUIET_MS = 10_000;
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
 * four counts of `message.usage` and of each of its `iterations`, and
 * `output_tokens_details.thinking_tokens`; the conversation itself is never kept.
 *
 * Counting rules, from real transcripts: one API message is written as several lines that repeat the same usage, so a
 * `message.id` is counted once; `iterations` hold the truth (an `advisor_message` iteration carries its own model and tokens
 * that the top-level counts leave out), so every iteration is summed under its own model, and the top-level counts are used
 * only when a message has no iterations.
 */
export class UsageMeter {
  /**
   * The tokens in the part of a transcript from `offset`, by flow and model, and the mark to continue from. Pure of the log.
   * A message belongs to the flow its line's branch names, else to what `fallback` says for the time of the line.
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
    fallback?: (opts: { time?: number }) => string | undefined;
  }): {
    byModel: Map<string, ITokens>;
    byFlow: Map<string | undefined, Map<string, ITokens>>;
    mark: IEventMark;
  } {
    const size = opts.size ?? statSync(opts.file).size;
    const start = opts.offset > size ? 0 : opts.offset;
    const side = opts.side ?? 'main';
    // One entry per message id, the largest count of each field over the lines that carry it.
    const counted = new Map<string, IMessage>();
    const held = new Map<string, IMessage>();
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
              ? message
              : {
                  ...known,
                  byModel: UsageMeter.largest({ left: known.byModel, right: message.byModel }),
                },
          );
        }
      }

      // A transcript with no first user line of its own (no session id on its lines) is counted whole.
      const messages = isStarted ? counted : new Map([...held, ...counted]);
      const byModel = new Map<string, ITokens>();
      const byFlow = new Map<string | undefined, Map<string, ITokens>>();

      for (const message of messages.values()) {
        const flowId = message.flowId ?? opts.fallback?.({ time: message.time });
        const ofFlow = byFlow.get(flowId) ?? new Map<string, ITokens>();

        for (const [model, tokens] of message.byModel) {
          UsageMeter.addTo({ totals: byModel, model, tokens });
          UsageMeter.addTo({ totals: ofFlow, model, tokens });
        }

        byFlow.set(flowId, ofFlow);
      }

      // The mark is the byte after the last whole line: the carried part was not read.
      const offset = position - carry.length;

      const mark = { offset, ...(last === undefined ? {} : { message: last }) };

      return { byModel, byFlow, mark };
    } finally {
      closeSync(descriptor);
    }
  }

  private static addTo(opts: {
    totals: Map<string, ITokens>;
    model: string;
    tokens: ITokens;
  }): void {
    const total = opts.totals.get(opts.model) ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };

    total.input += opts.tokens.input;
    total.output += opts.tokens.output;
    total.cacheRead += opts.tokens.cacheRead;
    total.cacheWrite += opts.tokens.cacheWrite;

    if (opts.tokens.thinking !== undefined) {
      total.thinking = (total.thinking ?? 0) + opts.tokens.thinking;
    }

    opts.totals.set(opts.model, total);
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

      const thinking = [a?.thinking, b?.thinking].filter((count) => count !== undefined);

      merged.set(model, {
        ...(thinking.length === 0 ? {} : { thinking: Math.max(...thinking) }),
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

  /** The id, the branch's flow, the time and the tokens of one transcript line, by model; `undefined` when it is not an assistant message with usage, or is of the other side. */
  private static messageOf(opts: {
    line: string;
    side: 'main' | 'sub';
  }): (IMessage & { id: string }) | undefined {
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

    // The thinking count is the message's own, beside the counts of its model; an advisor's iteration reports none.
    const details = usage.output_tokens_details;
    const own = byModel.get(model);

    if (
      own !== undefined &&
      RecordValue.isRecord(details) &&
      typeof details.thinking_tokens === 'number'
    ) {
      own.thinking = countOf({ value: details.thinking_tokens });
    }

    const branch = typeof value.gitBranch === 'string' ? value.gitBranch : '';
    const flowId = branch === '' ? undefined : EventFlow.fromBranchName({ branch });
    const time = typeof value.timestamp === 'string' ? Date.parse(value.timestamp) : Number.NaN;

    return {
      id: message.id,
      byModel,
      ...(flowId === undefined ? {} : { flowId }),
      ...(Number.isFinite(time) ? { time } : {}),
    };
  }

  /**
   * Records the new tokens of one transcript as `usage` lines, one per flow and model, all with one mark. A line's flow is
   * its branch's, else the flow the session `flowSession` had last named when it was written, else none. `known` is the log
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
    flowSession?: string;
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

    const { flowSession } = opts;
    const read = UsageMeter.tail({
      file: opts.file,
      size,
      offset: isFresh ? 0 : (found?.offset ?? 0),
      ...(isFresh || found?.message === undefined ? {} : { skipMessage: found.message }),
      ...(opts.side === undefined ? {} : { side: opts.side }),
      ...(isFresh && opts.session !== undefined ? { own: opts.session } : {}),
      ...(flowSession === undefined
        ? {}
        : {
            fallback: ({ time }: { time?: number }) =>
              FlowSteps.lastNamedBy({ events: opts.known, session: flowSession, before: time }),
          }),
    });
    const written: IEvent[] = [];

    for (const [flowId, byModel] of read.byFlow) {
      for (const [model, tokens] of byModel) {
        if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0) {
          continue;
        }

        const event = UsageMeter.build({
          ...opts,
          ...(flowId === undefined ? {} : { flowId }),
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
   * The tokens of a session since its last mark, from a `Stop` payload: the session's transcript, then what the
   * transcripts of its subagents beside it got after their marks, so what one wrote after its own stop is counted here. Nothing with
   * `events.log` off or without a transcript path; it throws nothing the caller must handle beyond the read of a file.
   */
  static recordSession(opts: {
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    now?: number;
  }): IEvent[] {
    const { input } = opts;
    const file = typeof input.transcript_path === 'string' ? input.transcript_path : '';
    const session = typeof input.session_id === 'string' ? input.session_id : '';
    const context = UsageMeter.contextOf(opts);

    if (context === undefined || file === '' || session === '') {
      return [];
    }

    const own = UsageMeter.record({
      ...context,
      file,
      ref: `transcript:${session}`,
      side: 'main',
      session,
      flowSession: session,
    });
    const folder = join(dirname(file), session, 'subagents');
    const names = existsSync(folder) ? readdirSync(folder).sort() : [];
    // Only a transcript the log has a mark for is read here: the first read of one is its own stop's. Without a mark the
    // whole file would be counted, however long ago its tokens were used.
    const marked = new Set(
      context.known.flatMap((event) =>
        event.type === EventTypes.USAGE && event.mark !== undefined && event.ref !== undefined
          ? [event.ref]
          : [],
      ),
    );

    return [
      ...own,
      ...names.flatMap((name) => {
        const id = SUBAGENT_FILE.exec(name)?.[1];

        if (
          id === undefined ||
          !marked.has(`transcript:${id}`) ||
          Date.now() - statSync(join(folder, name)).mtimeMs < SUBAGENT_QUIET_MS
        ) {
          return [];
        }

        const agent = UsageMeter.agentTypeOf({ file: join(folder, `agent-${id}.meta.json`) });

        return UsageMeter.record({
          ...context,
          file: join(folder, name),
          ref: `transcript:${id}`,
          side: 'sub',
          flowSession: session,
          ...(agent === undefined ? {} : { agent }),
        });
      }),
    ];
  }

  /** The tokens of a subagent since its last mark, from a `SubagentStop` payload; its fallback flow is its parent session's. */
  static recordSubagent(opts: {
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    now?: number;
  }): IEvent[] {
    const { input } = opts;
    const file = typeof input.agent_transcript_path === 'string' ? input.agent_transcript_path : '';
    const agentId = typeof input.agent_id === 'string' ? input.agent_id : '';
    const session = typeof input.session_id === 'string' ? input.session_id : '';
    const context = UsageMeter.contextOf(opts);

    if (context === undefined || file === '' || agentId === '') {
      return [];
    }

    return UsageMeter.record({
      ...context,
      file,
      ref: `transcript:${agentId}`,
      side: 'sub',
      ...(session === '' ? {} : { flowSession: session }),
      ...(typeof input.agent_type === 'string' && input.agent_type !== ''
        ? { agent: input.agent_type }
        : {}),
    });
  }

  /** The `agentType` of a subagent's `.meta.json`, or `undefined`. */
  private static agentTypeOf(opts: { file: string }): string | undefined {
    try {
      const value: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));

      return RecordValue.isRecord(value) && typeof value.agentType === 'string'
        ? value.agentType
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** What every record of one hook call shares, the log read once; `undefined` with `events.log` off. */
  private static contextOf(opts: {
    root: string;
    input: Record<string, unknown>;
    env: Record<string, string | undefined>;
    now?: number;
  }): { dir: string; actor: string; known: IEvent[]; windowDays: number; now: number } | undefined {
    const settings = EventSettings.read({ root: opts.root });

    if (!settings.log) {
      return undefined;
    }

    const dir = EventSettings.dirOf({ root: opts.root, settings });
    const actor = EventActor.resolve({
      sessionId: typeof opts.input.session_id === 'string' ? opts.input.session_id : undefined,
      env: opts.env,
    });
    const now = opts.now ?? Date.now();
    const windowDays = settings.maxAgeDays ?? EventConstants.DEFAULT_MAX_AGE_DAYS;
    // The log is read back over the retention window: the marks need all of it.
    const known = EventLog.read({ dir, since: now - windowDays * EventConstants.DAY_MS }).events;

    return { dir, actor, known, windowDays, now };
  }
}
