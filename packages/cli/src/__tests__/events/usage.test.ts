import { afterAll, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { BoardFold } from '../../board/fold.ts';
import { BoardTokens } from '../../board/tokens.ts';
import { RecordValue } from '../../common/record.ts';
import { EventLog, UsageMeter } from '../../events/index.ts';
import type { IEvent } from '../../events/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const FLOW = 'VULZ-ACME-1';
const ACTOR = 'pnt-vulcan-1';
const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890';
const BRANCH = `feat/${FLOW}-sign-in`;
const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');

interface ICounts {
  in?: number;
  out?: number;
  read?: number;
  write?: number;
}

const counts = (opts: ICounts) => ({
  inputTokens: opts.in ?? 0,
  outputTokens: opts.out ?? 0,
  cacheReadInputTokens: opts.read ?? 0,
  cacheCreationInputTokens: opts.write ?? 0,
});
/** An assistant line of a transcript: one content block of one API message. */
const assistant = (opts: {
  id: string;
  model?: string;
  top?: ICounts;
  iterations?: (ICounts & { type?: string; model?: string })[];
  text?: string;
  session?: string;
  sidechain?: boolean;
  branch?: string;
  at?: number;
}): string =>
  `${JSON.stringify({
    type: 'assistant',
    uuid: `u-${opts.id}-${Math.random()}`,
    timestamp: new Date(opts.at ?? Date.now()).toISOString(),
    ...(opts.branch === undefined ? {} : { gitBranch: opts.branch }),
    ...(opts.session === undefined ? {} : { sessionId: opts.session }),
    ...(opts.sidechain === undefined ? {} : { isSidechain: opts.sidechain }),
    message: {
      id: opts.id,
      model: opts.model ?? 'claude-sonnet-5-5',
      content: [{ type: 'text', text: opts.text ?? 'hello' }],
      usage: wire({
        ...counts(opts.top ?? {}),
        ...(opts.iterations === undefined
          ? {}
          : {
              iterations: opts.iterations.map((iteration) => ({
                ...counts(iteration),
                type: iteration.type ?? 'message',
                ...(iteration.model === undefined ? {} : { model: iteration.model }),
              })),
            }),
      }),
    },
  })}\n`;
/** A user line: the first one of a session starts it; one with `forkedFrom` was copied from another. */
const user = (opts: { session: string; forked?: boolean }): string =>
  `${JSON.stringify({
    type: 'user',
    sessionId: opts.session,
    timestamp: new Date().toISOString(),
    ...(opts.forked === true ? { forkedFrom: { sessionId: 'old' } } : {}),
    message: { role: 'user', content: 'a SECRET prompt' },
  })}\n`;
const userLine = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'a SECRET prompt' } })}\n`;

const project = (opts: { log?: boolean } = {}): string =>
  createProject({
    files: {
      '.agents/local/vulcan.manifest.json': JSON.stringify({
        project: { key: 'ACME' },
        events: { log: opts.log ?? true },
      }),
    },
  });
const dirOf = (root: string): string => join(root, '.agents/local/events');
const usageOf = (root: string) =>
  EventLog.read({ dir: dirOf(root) }).events.filter((event) => event.type === 'usage');
/** A flow line of the log: by default the one `SESSION` opened. */
const openFlow = (
  root: string,
  opts: { flowId?: string; session?: string; at?: number } = {},
): void => {
  EventLog.append({
    dir: dirOf(root),
    event: EventLog.build({
      type: 'flow',
      summary: 'Sign in',
      actor: ACTOR,
      source: 'cli',
      flowId: opts.flowId ?? FLOW,
      session: opts.session ?? SESSION,
      ...(opts.at === undefined ? {} : { now: opts.at }),
    }),
  });
};
const record = (opts: {
  root: string;
  file: string;
  ref?: string;
  flowSession?: string;
  now?: number;
  session?: string;
  side?: 'main' | 'sub';
}) =>
  UsageMeter.record({
    dir: dirOf(opts.root),
    file: opts.file,
    ref: opts.ref ?? 'transcript:t1',
    actor: ACTOR,
    known: EventLog.read({ dir: dirOf(opts.root) }).events,
    windowDays: 30,
    ...(opts.session === undefined ? {} : { session: opts.session }),
    ...(opts.side === undefined ? {} : { side: opts.side }),
    ...(opts.flowSession === undefined ? {} : { flowSession: opts.flowSession }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });

describe('UsageMeter.tail: counting a transcript', () => {
  test('a message split over several lines is counted once', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(
      file,
      userLine +
        assistant({ id: 'm1', top: { in: 2, out: 10, read: 100, write: 5 } }) +
        assistant({ id: 'm1', top: { in: 2, out: 10, read: 100, write: 5 } }) +
        assistant({ id: 'm1', top: { in: 2, out: 10, read: 100, write: 5 } }) +
        assistant({ id: 'm2', top: { in: 1, out: 3 } }),
    );

    const { byModel } = UsageMeter.tail({ file, offset: 0 });

    expect(byModel.get('claude-sonnet-5-5')).toEqual({
      input: 3,
      output: 13,
      cacheRead: 100,
      cacheWrite: 5,
    });
  });

  test('every iteration counts under its own model: the advisor is not lost', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(
      file,
      assistant({
        id: 'm1',
        top: { in: 4, out: 2834, read: 548149, write: 2248 },
        iterations: [
          { in: 2, out: 63, read: 273789, write: 571 },
          { in: 231321, out: 17384, type: 'advisor_message', model: 'claude-opus-5-5' },
          { in: 2, out: 2771, read: 274360, write: 1677 },
        ],
      }),
    );

    const { byModel } = UsageMeter.tail({ file, offset: 0 });

    expect(byModel.get('claude-sonnet-5-5')).toEqual({
      input: 4,
      output: 2834,
      cacheRead: 548149,
      cacheWrite: 2248,
    });
    expect(byModel.get('claude-opus-5-5')).toEqual({
      input: 231321,
      output: 17384,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  test('zero top-level counts with real iterations are read from the iterations', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(file, assistant({ id: 'm1', iterations: [{ in: 7, out: 9 }] }));
    expect(UsageMeter.tail({ file, offset: 0 }).byModel.get('claude-sonnet-5-5')?.output).toBe(9);
  });

  test('reading in two ticks gives the same totals as reading at once, even when a message straddles the mark', () => {
    const file = join(project(), 't.jsonl');
    const first = assistant({ id: 'm1', top: { in: 1, out: 10 } }) + userLine;
    const straddle = assistant({ id: 'm2', top: { in: 2, out: 20 } });

    writeFileSync(file, first + straddle);

    const whole = UsageMeter.tail({ file, offset: 0 }).byModel.get('claude-sonnet-5-5');
    // The meter stopped after the first line of m2; the next line of m2 arrives afterwards.
    const early = UsageMeter.tail({ file, offset: 0 });

    appendFileSync(file, straddle);
    appendFileSync(file, assistant({ id: 'm3', top: { in: 4, out: 40 } }));

    const late = UsageMeter.tail({
      file,
      offset: early.mark.offset,
      skipMessage: early.mark.message,
    });
    const all = UsageMeter.tail({ file, offset: 0 }).byModel.get('claude-sonnet-5-5');

    expect(whole).toEqual({ input: 3, output: 30, cacheRead: 0, cacheWrite: 0 });
    expect(late.byModel.get('claude-sonnet-5-5')).toEqual({
      input: 4,
      output: 40,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(all).toEqual({ input: 7, output: 70, cacheRead: 0, cacheWrite: 0 });
  });

  test('a line still being written is not read, and is read the next time', () => {
    const file = join(project(), 't.jsonl');
    const whole = assistant({ id: 'm2', top: { in: 5, out: 50 } });

    writeFileSync(file, assistant({ id: 'm1', top: { in: 1, out: 10 } }) + whole.slice(0, 40));

    const first = UsageMeter.tail({ file, offset: 0 });

    expect(first.byModel.get('claude-sonnet-5-5')?.output).toBe(10);
    appendFileSync(file, whole.slice(40));

    const next = UsageMeter.tail({
      file,
      offset: first.mark.offset,
      skipMessage: first.mark.message,
    });

    expect(next.byModel.get('claude-sonnet-5-5')?.output).toBe(50);
  });

  test('lines that are not assistant messages with usage, and broken lines, are skipped', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(
      file,
      `${userLine}{ not json "type":"assistant" }\n${JSON.stringify({ type: 'assistant', message: { id: 'x' } })}\n` +
        assistant({ id: 'm1', top: { in: 1, out: 2 } }),
    );
    expect(UsageMeter.tail({ file, offset: 0 }).byModel.get('claude-sonnet-5-5')?.output).toBe(2);
  });

  test('a file that is shorter than the mark is read from its start', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(file, assistant({ id: 'm1', top: { in: 1, out: 2 } }));
    expect(
      UsageMeter.tail({ file, offset: 999_999, skipMessage: 'm1' }).byModel.get('claude-sonnet-5-5')
        ?.output,
    ).toBe(2);
  });
});

describe('UsageMeter.record: the lines and the mark', () => {
  test('one line per model, the fixed word, no money field, and a second call counts nothing twice', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(
      file,
      assistant({
        id: 'm1',
        branch: BRANCH,
        iterations: [
          { in: 1, out: 10 },
          { in: 50, out: 5, type: 'advisor_message', model: 'claude-opus-5-5' },
        ],
      }),
    );

    const lines = record({ root, file });

    expect(lines.map((line) => line.usage?.model).sort()).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
    expect(lines.every((line) => line.summary === 'tokens' && line.flowId === FLOW)).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/price|cost|usd|dollar|\$|rate/i);
    expect(record({ root, file })).toEqual([]);

    appendFileSync(file, assistant({ id: 'm2', top: { in: 0, out: 7 }, branch: BRANCH }));

    const more = record({ root, file });

    expect(more).toHaveLength(1);
    expect(more[0]?.usage?.output).toBe(7);
    expect(usageOf(root)).toHaveLength(3);
  });

  test('a transcript over the first-read limit is marked at its end and counts nothing; what follows counts', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(file, assistant({ id: 'm1', top: { in: 1, out: 10 } }));
    // A sparse file past 128 MB: only its size is read on this path.
    truncateSync(file, 129 * 1024 * 1024);

    const [mark] = record({ root, file });

    expect(mark?.usage).toEqual({
      model: 'none',
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(mark?.mark?.offset).toBe(129 * 1024 * 1024);

    appendFileSync(file, `\n${assistant({ id: 'm2', top: { in: 3, out: 30 } })}`);
    expect(record({ root, file }).map((line) => line.usage?.output)).toEqual([30]);
  });

  test('a transcript of 16 MB is read whole now, within the 128 MB limit', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(
      file,
      assistant({ id: 'm1', top: { in: 1, out: 10 }, text: 'x'.repeat(16 * 1024 * 1024) }),
    );
    expect(record({ root, file }).map((line) => line.usage?.output)).toEqual([10]);
  });

  test('a mark older than two days is found: an idle session resumed counts only what is new', () => {
    const root = project();
    const file = join(root, 't.jsonl');
    const day = 24 * 60 * 60 * 1000;

    writeFileSync(file, assistant({ id: 'm1', top: { in: 1, out: 10 } }));
    record({ root, file, now: Date.now() - 10 * day });
    appendFileSync(file, assistant({ id: 'm2', top: { in: 2, out: 20 } }));
    expect(record({ root, file }).map((line) => line.usage?.output)).toEqual([20]);
  });

  test('a transcript whose first line is older than the window and has no mark is only marked at its end', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(
      file,
      `${JSON.stringify({ type: 'user', timestamp: '2020-01-01T00:00:00Z', sessionId: 's' })}\n${assistant({ id: 'm1', top: { in: 1, out: 10 } })}`,
    );

    const lines = record({ root, file });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.usage?.model).toBe('none');
    expect(lines[0]?.mark?.offset).toBe(statSync(file).size);
  });

  test('a file shorter than its mark is read again from its start as a first sight', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    writeFileSync(
      file,
      `${user({ session: 's1' })}${assistant({ id: 'm1', top: { in: 1, out: 10 } })}${assistant({ id: 'm2', top: { in: 1, out: 20 } })}`,
    );
    record({ root, file, session: 's1' });
    writeFileSync(
      file,
      `${user({ session: 's1' })}${assistant({ id: 'm3', top: { in: 1, out: 7 } })}`,
    );
    expect(record({ root, file, session: 's1' }).map((line) => line.usage?.output)).toEqual([7]);
  });

  test('no file, no tokens and a line with no flow write what they should', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    expect(record({ root, file: join(root, 'nope.jsonl') })).toEqual([]);
    writeFileSync(file, userLine);
    expect(record({ root, file })).toEqual([]);
    writeFileSync(file, assistant({ id: 'm1', top: { in: 1, out: 2 } }));
    expect(record({ root, file })[0]?.flowId).toBeUndefined();
  });

  test('two transcripts keep their own marks', () => {
    const root = project();
    const a = join(root, 'a.jsonl');
    const b = join(root, 'b.jsonl');

    writeFileSync(a, assistant({ id: 'a1', top: { in: 1, out: 1 } }));
    writeFileSync(b, assistant({ id: 'b1', top: { in: 2, out: 2 } }));
    record({ root, file: a, ref: 'transcript:a' });
    expect(record({ root, file: b, ref: 'transcript:b' })).toHaveLength(1);
    expect(record({ root, file: a, ref: 'transcript:a' })).toEqual([]);
  });
});

describe('what a read counts and what it does not', () => {
  test('history copied into the file (another session, or forkedFrom) is not counted: only what follows the first own user line', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(
      file,
      assistant({ id: 'old1', top: { in: 1, out: 1000 }, session: 'old' }) +
        user({ session: 'old' }) +
        user({ session: 'new', forked: true }) +
        assistant({ id: 'old2', top: { in: 1, out: 2000 }, session: 'new' }) +
        user({ session: 'new' }) +
        assistant({ id: 'own1', top: { in: 3, out: 30 }, session: 'new' }),
    );
    expect(
      UsageMeter.tail({ file, offset: 0, own: 'new' }).byModel.get('claude-sonnet-5-5')?.output,
    ).toBe(30);
  });

  test('a transcript with no user line of its own is counted whole', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(
      file,
      assistant({ id: 'a', top: { in: 1, out: 5 } }) +
        assistant({ id: 'b', top: { in: 1, out: 6 } }),
    );
    expect(
      UsageMeter.tail({ file, offset: 0, own: 'new' }).byModel.get('claude-sonnet-5-5')?.output,
    ).toBe(11);
  });

  test('a session read drops the lines of subagents, and a subagent read keeps only them', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(
      file,
      assistant({ id: 'main1', top: { in: 1, out: 10 } }) +
        assistant({ id: 'side1', top: { in: 1, out: 500 }, sidechain: true }),
    );
    expect(UsageMeter.tail({ file, offset: 0 }).byModel.get('claude-sonnet-5-5')?.output).toBe(10);
    expect(
      UsageMeter.tail({ file, offset: 0, side: 'sub' }).byModel.get('claude-sonnet-5-5')?.output,
    ).toBe(500);
  });

  test('a message repeated over lines counts at the largest line of each count, not the first', () => {
    const file = join(project(), 't.jsonl');

    writeFileSync(
      file,
      assistant({ id: 'm1', top: { in: 1, out: 4 } }) +
        assistant({ id: 'm1', top: { in: 1, out: 9, read: 50 } }),
    );
    expect(UsageMeter.tail({ file, offset: 0 }).byModel.get('claude-sonnet-5-5')).toEqual({
      input: 1,
      output: 9,
      cacheRead: 50,
      cacheWrite: 0,
    });
  });
});

describe('the hooks that record', () => {
  const stopInput = (root: string, file: string) => ({
    hookEventName: 'Stop',
    sessionId: SESSION,
    cwd: root,
    transcriptPath: file,
    stopHookActive: false,
  });
  const run = (opts: { script: string; root: string; input: unknown }) =>
    spawnSyncBounded({
      cmd: [process.execPath, join(HOOKS, opts.script)],
      cwd: opts.root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, VULCAN_ACTOR: ACTOR },
      stdin: new TextEncoder().encode(JSON.stringify(wire(opts.input))),
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test('the Stop script records the turn on the flow the session opened, and a second Stop counts nothing again', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    openFlow(root);
    writeFileSync(
      file,
      userLine + assistant({ id: 'm1', top: { in: 3, out: 30, read: 300, write: 3 } }),
    );

    const first = run({ script: 'board-stop.ts', root, input: stopInput(root, file) });
    const again = run({ script: 'board-stop.ts', root, input: stopInput(root, file) });
    const lines = usageOf(root);

    expect(first.exitCode).toBe(0);
    expect(again.exitCode).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.flowId).toBe(FLOW);
    expect(lines[0]?.ref).toBe(`transcript:${SESSION}`);
    expect(lines[0]?.usage).toEqual({
      model: 'claude-sonnet-5-5',
      input: 3,
      output: 30,
      cacheRead: 300,
      cacheWrite: 3,
    });
    expect(JSON.stringify(EventLog.read({ dir: dirOf(root) }).events)).not.toContain('SECRET');
  });

  test('a hold does not stop the record, and a project with the log off records nothing', () => {
    const off = project({ log: false });
    const file = join(off, 't.jsonl');

    writeFileSync(file, assistant({ id: 'm1', top: { in: 3, out: 30 } }));
    run({ script: 'board-stop.ts', root: off, input: stopInput(off, file) });
    expect(usageOf(off)).toEqual([]);
  });

  test('a transcript that cannot be read lets the turn end', () => {
    const root = project();
    const child = run({
      script: 'board-stop.ts',
      root,
      input: stopInput(root, join(root, 'missing.jsonl')),
    });

    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toBe('');
    expect(usageOf(root)).toEqual([]);
  });

  test('a subagent stop records its tokens with its agent type, on its parent session', () => {
    const root = project();
    const file = join(root, 'agent.jsonl');

    openFlow(root);
    writeFileSync(
      file,
      assistant({ id: 'a1', model: 'claude-haiku-5-5', top: { in: 9, out: 90 }, sidechain: true }),
    );

    const child = run({
      script: 'event.ts',
      root,
      input: {
        hookEventName: 'SubagentStop',
        sessionId: SESSION,
        cwd: root,
        agentId: 'agent-77',
        agentType: 'Explore',
        agentTranscriptPath: file,
      },
    });
    const [line] = usageOf(root);

    expect(child.exitCode).toBe(0);
    expect(line?.flowId).toBe(FLOW);
    expect(line?.ref).toBe('transcript:agent-77');
    expect(line?.usage).toEqual({
      model: 'claude-haiku-5-5',
      agent: 'Explore',
      input: 9,
      output: 90,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(
      EventLog.read({ dir: dirOf(root) }).events.some((event) => event.type === 'subagent-stop'),
    ).toBe(true);
  });
});

/** What the lines hold, per flow: the output tokens, `-` for no flow. */
const outputByFlow = (lines: IEvent[]): Record<string, number> =>
  lines.reduce<Record<string, number>>((sums, line) => {
    const id = line.flowId ?? '-';

    sums[id] = (sums[id] ?? 0) + (line.usage?.output ?? 0);

    return sums;
  }, {});

/** A hook payload from camelCase words, as Claude Code sends it. */
const hookInput = (value: object): Record<string, unknown> => {
  const input: unknown = wire(value);

  if (!RecordValue.isRecord(input)) {
    throw new Error('not a payload');
  }

  return input;
};

describe('the flow of each line of a transcript', () => {
  const stop = (root: string, file: string, session = SESSION): IEvent[] =>
    UsageMeter.recordSession({
      root,
      input: hookInput({ sessionId: session, cwd: root, transcriptPath: file }),
      env: { VULCAN_ACTOR: ACTOR },
    });

  test('branch switches inside one Stop window: each line goes to its branch, one usage line per flow and model, one mark', () => {
    const root = project();
    const file = join(root, 't.jsonl');

    openFlow(root, { flowId: 'VULZ-ACME-3' });
    writeFileSync(
      file,
      assistant({ id: 'm1', top: { out: 10 }, branch: 'feat/VULZ-ACME-1-a' }) +
        assistant({ id: 'm2', top: { out: 20 }, branch: 'feat/VULZ-ACME-2-b' }) +
        assistant({
          id: 'm3',
          top: { out: 5 },
          branch: 'feat/VULZ-ACME-2-b',
          model: 'claude-opus-5-5',
        }) +
        assistant({ id: 'm4', top: { out: 40 }, branch: 'feat/VULZ-ACME-1-a' }),
    );

    const lines = stop(root, file);

    expect(outputByFlow(lines)).toEqual({ 'VULZ-ACME-1': 50, 'VULZ-ACME-2': 25 });
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((line) => JSON.stringify(line.mark))).size).toBe(1);
    expect(stop(root, file)).toEqual([]);
  });

  test('a Stop that never ran changes nothing: the next one gives each line its own flow', () => {
    const root = project();
    const file = join(root, 't.jsonl');
    const now = Date.now();

    openFlow(root, { flowId: 'VULZ-ACME-1', at: now - 3000 });
    writeFileSync(
      file,
      assistant({ id: 'm1', top: { out: 10 }, branch: 'develop', at: now - 2000 }),
    );
    // No Stop here. The session moves on to another flow before the next one.
    openFlow(root, { flowId: 'VULZ-ACME-2', at: now - 1000 });
    appendFileSync(file, assistant({ id: 'm2', top: { out: 7 }, branch: 'develop', at: now }));

    expect(outputByFlow(stop(root, file))).toEqual({ 'VULZ-ACME-1': 10, 'VULZ-ACME-2': 7 });
  });

  test('with no flow in the branch, only a flow this session named counts: not one of another session with the same name', () => {
    const root = project();
    const file = join(root, 't.jsonl');
    const now = Date.now();

    writeFileSync(
      file,
      assistant({ id: 'm1', top: { out: 3 }, branch: 'develop', at: now - 5000 }),
    );
    openFlow(root, { flowId: 'VULZ-ACME-1', at: now - 4000 });
    appendFileSync(
      file,
      assistant({ id: 'm2', top: { out: 11 }, branch: 'develop', at: now - 3000 }),
    );
    openFlow(root, { flowId: 'VULZ-ACME-9', session: 'another-session', at: now - 2000 });
    appendFileSync(
      file,
      assistant({ id: 'm3', top: { out: 13 }, branch: 'develop', at: now - 1000 }),
    );

    // What came before the session named a flow has none.
    expect(outputByFlow(stop(root, file))).toEqual({ '-': 3, 'VULZ-ACME-1': 24 });
  });

  test('a Stop of the session reads what its subagents wrote after their own stop, from their marks, once', () => {
    const root = project();
    const file = join(root, `${SESSION}.jsonl`);
    const folder = join(root, SESSION, 'subagents');
    const agent = join(folder, 'agent-a77.jsonl');
    const sub = (id: string, out: number): string =>
      assistant({ id, top: { out }, sidechain: true, branch: BRANCH, model: 'claude-haiku-5-5' });

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'agent-a77.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    writeFileSync(file, assistant({ id: 'm1', top: { out: 1 }, branch: BRANCH }));
    writeFileSync(agent, sub('a1', 90));
    UsageMeter.recordSubagent({
      root,
      input: hookInput({
        sessionId: SESSION,
        agentId: 'a77',
        agentType: 'Explore',
        agentTranscriptPath: agent,
      }),
      env: { VULCAN_ACTOR: ACTOR },
    });
    appendFileSync(agent, sub('a2', 8));
    // One that never had a stop of its own.
    writeFileSync(join(folder, 'agent-b88.jsonl'), sub('b1', 4));

    const lines = stop(root, file);

    expect(lines.map((line) => [line.ref, line.usage?.agent, line.usage?.output]).sort()).toEqual([
      ['transcript:a77', 'Explore', 8],
      [`transcript:${SESSION}`, undefined, 1],
      ['transcript:b88', undefined, 4],
    ]);
    expect(lines.every((line) => line.flowId === FLOW)).toBe(true);
    expect(stop(root, file)).toEqual([]);
  });
});

describe('the board adds the tokens up', () => {
  const usage = (opts: {
    flow?: string;
    actor: string;
    model: string;
    agent?: string;
    in: number;
    out: number;
  }) =>
    EventLog.build({
      type: 'usage',
      summary: 'tokens',
      actor: opts.actor,
      source: 'claude-hook',
      ...(opts.flow === undefined ? {} : { flowId: opts.flow }),
      usage: {
        model: opts.model,
        ...(opts.agent === undefined ? {} : { agent: opts.agent }),
        input: opts.in,
        output: opts.out,
        cacheRead: 10,
        cacheWrite: 1,
      },
      mark: { offset: 1 },
    });

  test('per flow, by agent and by model, and a flow with none has none', () => {
    const tokens = BoardTokens.of({
      unflowed: 'Unsorted',
      events: [
        usage({ flow: FLOW, actor: 'a', model: 'm1', in: 1, out: 100 }),
        usage({ flow: FLOW, actor: 'a', model: 'm2', in: 2, out: 50 }),
        usage({ flow: FLOW, actor: 'b', model: 'm1', agent: 'Explore', in: 3, out: 5 }),
        usage({ actor: 'a', model: 'm1', in: 9, out: 9 }),
      ],
    });
    const flow = tokens[FLOW];

    expect(flow).toMatchObject({ input: 6, output: 155, cacheRead: 30, cacheWrite: 3 });
    expect(flow?.agents.map((row) => row.name)).toEqual(['a', 'b (Explore)']);
    expect(flow?.models.map((row) => row.name)).toEqual(['m1', 'm2']);
    expect(tokens.Unsorted).toMatchObject({ input: 9, output: 9 });
    expect(tokens['VULZ-ACME-2']).toBeUndefined();
  });

  test('a usage line is no line of a flow; with no flow it keeps the page group that shows it', () => {
    const log = BoardFold.fromLog({
      events: [
        usage({ flow: FLOW, actor: 'a', model: 'm1', in: 1, out: 1 }),
        usage({ actor: 'a', model: 'm1', in: 2, out: 2 }),
      ],
    });

    expect(log.events.map((event) => event.flowId)).toEqual(['Unsorted']);
    expect(log.events[0]?.plumbing).toBe(true);
    expect(Object.keys(log.tokens).sort()).toEqual(['Unsorted', FLOW]);
  });

  test('no price, cost or money word is in the line schema or the board data', () => {
    const tokens = BoardTokens.of({
      unflowed: 'Unsorted',
      events: [usage({ flow: FLOW, actor: 'a', model: 'm1', in: 1, out: 1 })],
    });

    expect(JSON.stringify(tokens)).not.toMatch(/price|cost|usd|dollar|\$|rate|money/i);
  });
});
