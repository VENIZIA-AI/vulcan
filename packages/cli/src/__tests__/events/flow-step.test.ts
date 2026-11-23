import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { EventHook, EventLog, FlowSteps } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const project = (opts: { log?: boolean } = {}): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': JSON.stringify({
        project: { key: 'ACME' },
        events: { log: opts.log ?? true },
      }),
    },
  });
const dirOf = (root: string): string => join(root, '.agents/local/events');
const linesOf = (root: string) => EventLog.read({ dir: dirOf(root) }).events;
const cli = (opts: { root: string; args: string[] }) =>
  runCli({
    args: ['event', ...opts.args],
    cwd: opts.root,
    env: { ...hermeticEnv(), VULCAN_ACTOR: 'pnt-vulcan-1' },
  });
const open = (root: string): string =>
  cli({
    root,
    args: [
      'add',
      '--kind',
      'flow',
      '--title',
      'Sign in',
      '--why',
      'Users cannot sign in',
      '--context',
      'Half done',
      '--next',
      'review',
      '--due',
      '2026-12-01',
      '--step-done',
      'Token',
      '--step',
      'Refresh',
      '--check',
      'Signs in',
      '--app',
      'web',
    ],
  }).stdout.trim();

describe('vulcan event step', () => {
  test('changes one step and keeps every other field of the flow line', () => {
    const root = project();
    const id = open(root);
    const done = cli({ root, args: ['step', '--flow', id, '--done', 'Refresh'] });
    const last = linesOf(root).at(-1);

    expect(done.code).toBe(0);
    expect(last?.kind).toBe('flow');
    expect(last?.summary).toBe('Sign in');
    expect(last?.flowId).toBe(id);
    expect(last?.steps).toEqual([
      { text: 'Token', done: true },
      { text: 'Refresh', done: true },
    ]);
    expect(last?.why).toBe('Users cannot sign in');
    expect(last?.context).toBe('Half done');
    expect(last?.next).toBe('review');
    expect(last?.due).toBe('2026-12-01');
    expect(last?.checks).toEqual([{ text: 'Signs in', done: false }]);
    expect(last?.apps).toEqual(['web']);
  });

  test('--todo reopens a step, and a step that is not there is added; repeating one adds no line of its own meaning', () => {
    const root = project();
    const id = open(root);

    cli({ root, args: ['step', '--flow', id, '--todo', 'Token'] });
    cli({ root, args: ['step', '--flow', id, '--todo', 'Logout'] });

    expect(linesOf(root).at(-1)?.steps).toEqual([
      { text: 'Token', done: false },
      { text: 'Refresh', done: false },
      { text: 'Logout', done: false },
    ]);
  });

  test('--next and --context alone are a line, and the steps stay', () => {
    const root = project();
    const id = open(root);
    const result = cli({ root, args: ['step', '--flow', id, '--next', 'merge it'] });

    expect(result.code).toBe(0);
    expect(linesOf(root).at(-1)?.next).toBe('merge it');
    expect(linesOf(root).at(-1)?.steps).toHaveLength(2);
  });

  test.each([
    [['step', '--flow', 'VULZ-ACME-1'], 'needs'],
    [['step', '--flow', 'VULZ-ACME-1', '--done', 'a', '--todo', 'b'], 'not both'],
    [['step', '--flow', 'VULZ-ACME-1', '--done', ''], 'text'],
    [['step', '--flow', 'VULZ-ACME-1', '--done', 'a', '--title', 'x'], 'does not take'],
    [['step', '--flow', 'VULZ-ACME-1', '--step', 'a'], 'usage'],
  ])('%j is refused', (args, word) => {
    const root = project();
    const result = cli({ root, args });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(word);
    expect(linesOf(root)).toHaveLength(0);
  });

  test('a flow with no flow line, and a flow that does not exist, say what to run', () => {
    const root = project();
    const unknown = cli({ root, args: ['step', '--flow', 'VULZ-ACME-7', '--done', 'a'] });

    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('no flow VULZ-ACME-7');

    EventLog.append({
      dir: dirOf(root),
      event: EventLog.build({
        kind: 'commit',
        summary: 'x',
        actor: 'a',
        source: 'cli',
        flowId: 'VULZ-ACME-7',
      }),
    });

    const bare = cli({ root, args: ['step', '--flow', 'VULZ-ACME-7', '--done', 'a'] });

    expect(bare.code).not.toBe(0);
    expect(bare.stderr).toContain('has no flow line yet');
  });
});

describe('FlowSteps', () => {
  const steps = [
    { text: 'a', done: false },
    { text: 'b', done: true },
  ];

  test('withStep sets, reopens and appends, matching the text as the log keeps it', () => {
    expect(FlowSteps.withStep({ steps, text: ' a ', done: true })[0]).toEqual({
      text: 'a',
      done: true,
    });
    expect(FlowSteps.withStep({ steps, text: 'b', done: false })[1]).toEqual({
      text: 'b',
      done: false,
    });
    expect(FlowSteps.withStep({ steps, text: 'c', done: false })).toHaveLength(3);
  });

  test('isSame compares text, state and order', () => {
    expect(FlowSteps.isSame({ first: steps, second: [...steps] })).toBe(true);
    expect(FlowSteps.isSame({ first: steps, second: [...steps].reverse() })).toBe(false);
    expect(FlowSteps.isSame({ first: steps, second: steps.slice(0, 1) })).toBe(false);
  });
});

describe('the TodoWrite mirror', () => {
  const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890';
  const call = (opts: { root: string; todos: unknown[]; env?: Record<string, string> }) =>
    EventHook.run({
      root: opts.root,
      input: wire({
        hookEventName: 'PostToolUse',
        toolName: 'TodoWrite',
        sessionId: SESSION,
        cwd: opts.root,
        toolInput: { todos: opts.todos },
      }),
      env: { VULCAN_ACTOR: 'pnt-vulcan-1', ...opts.env },
    });

  test('the list becomes the steps of the flow this session last opened, the rest copied forward', () => {
    const root = project();
    const id = open(root);
    const line = call({
      root,
      todos: [
        { content: 'Token', status: 'completed', activeForm: 'x' },
        { content: 'Refresh', status: 'in_progress', activeForm: 'x' },
        { content: 'Docs', status: 'pending', activeForm: 'x' },
      ],
    });

    expect(line?.flowId).toBe(id);
    expect(line?.source).toBe('claude-hook');
    expect(line?.steps).toEqual([
      { text: 'Token', done: true },
      { text: 'Refresh', done: false },
      { text: 'Docs', done: false },
    ]);
    expect(line?.why).toBe('Users cannot sign in');
    expect(line?.checks).toEqual([{ text: 'Signs in', done: false }]);
  });

  test('the same list again writes nothing, and an empty one never wipes the steps', () => {
    const root = project();

    open(root);

    const todos = [{ content: 'Token', status: 'pending', activeForm: 'x' }];

    expect(call({ root, todos })).toBeDefined();
    expect(call({ root, todos })).toBeUndefined();
    expect(call({ root, todos: [] })).toBeUndefined();
    expect(linesOf(root).filter((line) => line.source === 'claude-hook')).toHaveLength(1);
  });

  test('no flow, another session, a log that is off and a malformed call write nothing and never throw', () => {
    const none = project();
    const off = project({ log: false });
    const other = project();

    open(off);
    open(other);

    expect(call({ root: none, todos: [{ content: 'a', status: 'pending' }] })).toBeUndefined();
    expect(call({ root: off, todos: [{ content: 'a', status: 'pending' }] })).toBeUndefined();
    expect(
      call({
        root: other,
        todos: [{ content: 'a', status: 'pending' }],
        env: { VULCAN_ACTOR: 'someone-else' },
      }),
    ).toBeUndefined();
    expect(call({ root: other, todos: ['x', 4, null, { content: 7 }] })).toBeUndefined();
  });

  test('a step text with a secret is redacted like every text of the log', () => {
    const root = project();

    open(root);

    const line = call({
      root,
      todos: [{ content: 'use password=hunter2hunter2 here', status: 'pending' }],
    });

    expect(JSON.stringify(line?.steps)).not.toContain('hunter2');
  });
});
