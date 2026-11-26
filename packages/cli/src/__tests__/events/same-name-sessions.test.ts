import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  BoardStop,
  EventHook,
  EventLog,
  FlowState,
  FlowSteps,
  PromptContext,
} from '../../events/index.ts';
import type { IEvent, TGitActivity } from '../../events/index.ts';
import { FlowGuard } from '../../hooks/flow-guard.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const T0 = Date.parse('2026-11-23T09:00:00Z');
const NAME = 'pnt-vulcan-1';
const FIRST = '11111111-aaaa-4bbb-8ccc-000000000001';
const SECOND = '22222222-aaaa-4bbb-8ccc-000000000002';
const OWN = 'VULZ-ACME-1';
const OTHER = 'VULZ-ACME-2';

const flowLine = (opts: { root: string; flowId: string; at: number; session?: string }): void => {
  EventLog.append({
    dir: join(opts.root, '.agents/local/events'),
    event: EventLog.build({
      type: 'flow',
      summary: `Work of ${opts.flowId}`,
      actor: NAME,
      source: 'cli',
      flowId: opts.flowId,
      steps: [{ text: `Step of ${opts.flowId}`, done: false }],
      ...(opts.session === undefined ? {} : { session: opts.session }),
      now: opts.at,
    }),
  });
};

/** Two sessions with one name, working at once: the second wrote its flow line after the first. */
const project = (): string => {
  const root = createProject({
    files: {
      '.agents/local/vulcan.manifest.json': JSON.stringify({
        project: { key: 'ACME' },
        events: { log: true },
      }),
    },
  });

  flowLine({ root, flowId: OWN, at: T0, session: FIRST });
  flowLine({ root, flowId: OTHER, at: T0 + 1000, session: SECOND });

  return root;
};
const log = (root: string): IEvent[] =>
  EventLog.read({ dir: join(root, '.agents/local/events') }).events;
const hook = (opts: {
  root: string;
  session: string;
  call: Record<string, unknown>;
  activity?: TGitActivity;
}) =>
  EventHook.run({
    root: opts.root,
    input: wire({
      hookEventName: 'PostToolUse',
      sessionId: opts.session,
      cwd: opts.root,
      ...opts.call,
    }),
    env: { VULCAN_ACTOR: NAME },
    isOver: FlowState.isOver,
    now: T0 + 60_000,
    ...(opts.activity === undefined ? {} : { activity: opts.activity }),
  });
const context = (opts: { root: string; session: string }): string | undefined =>
  PromptContext.build({
    root: opts.root,
    input: wire({ hookEventName: 'UserPromptSubmit', sessionId: opts.session, cwd: opts.root }),
    env: { VULCAN_ACTOR: NAME },
    isOver: FlowState.isOver,
    now: T0 + 60_000,
  })?.hookSpecificOutput.additionalContext;
const commit = { toolName: 'Bash', toolInput: { command: 'git commit -m x' } };
const todos = {
  toolName: 'TodoWrite',
  toolInput: { todos: [{ content: 'A task of this session', status: 'pending' }] },
};
const guard = (opts: { root: string; session?: string }) =>
  FlowGuard.inspect({
    root: opts.root,
    command: 'git commit -m x',
    cwd: opts.root,
    ...(opts.session === undefined ? {} : { sessionId: opts.session }),
    env: { VULCAN_ACTOR: NAME },
    isOver: FlowState.isOver,
    now: T0 + 60_000,
  });

describe('two sessions with one name, in parallel: a hook reads and writes its own flow only', () => {
  test('the prompt context shows each session its own flow, and a third session none', () => {
    const root = project();

    expect(context({ root, session: FIRST })).toContain(`flow ${OWN} `);
    expect(context({ root, session: FIRST })).not.toContain(OTHER);
    expect(context({ root, session: SECOND })).toContain(`flow ${OTHER} `);
    expect(context({ root, session: 'a-third-session' })).toBeUndefined();
  });

  test('the Stop hold names the flow the session committed on, never the newer one of the other', () => {
    const root = project();
    const stop = (session: string) =>
      BoardStop.decide({
        root,
        input: wire({ hookEventName: 'Stop', sessionId: session, cwd: root }),
        env: { VULCAN_ACTOR: NAME },
        isOver: FlowState.isOver,
        edited: () => false,
        now: T0 + 120_000,
      });

    hook({ root, session: FIRST, call: commit, activity: 'commit' });
    expect(stop(FIRST)?.reason).toContain(OWN);
    expect(stop(SECOND)).toBeUndefined();
    expect(stop('a-third-session')).toBeUndefined();
  });

  test('a task list is merged into the flow of the session that wrote it', () => {
    const root = project();
    const written = hook({ root, session: FIRST, call: todos });

    expect(written?.flowId).toBe(OWN);
    expect(written?.session).toBe(FIRST);
    expect(hook({ root, session: 'a-third-session', call: todos })).toBeUndefined();
    expect(log(root).filter((event) => event.flowId === OTHER)).toHaveLength(1);
  });

  test('a commit line goes to the flow of its session, and to none for a session with no flow', () => {
    const root = project();

    expect(hook({ root, session: FIRST, call: commit, activity: 'commit' })?.flowId).toBe(OWN);

    const unplaced = hook({ root, session: 'a-third-session', call: commit, activity: 'commit' });

    expect(unplaced?.type).toBe('commit');
    expect(unplaced?.flowId).toBeUndefined();
  });

  test('the commit guard counts only a flow this session wrote', () => {
    const root = project();

    expect(guard({ root, session: FIRST })).toEqual([]);
    expect(guard({ root, session: 'a-third-session' })[0]?.rule).toBe('V-P-13');
  });

  test.each([undefined, ''])(
    'with no session id (%p) a flow line that has none is not taken for it',
    (session) => {
      const root = project();

      flowLine({ root, flowId: 'VULZ-ACME-3', at: T0 + 2000 });

      expect(
        FlowSteps.flowOf({
          events: log(root),
          cwd: root,
          ...(session === undefined ? {} : { session }),
          isOver: () => false,
        }),
      ).toBeUndefined();
    },
  );
});
