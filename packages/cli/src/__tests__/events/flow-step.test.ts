import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { join } from 'node:path';
import { EventHook, EventLog, FlowState, FlowSteps } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);
// Each test starts a few `vulcan` processes: on a loaded runner five seconds is not enough, and the CLI path is what is under test.
setDefaultTimeout(30_000);

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
      '--type',
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
      '--ref',
      'TRK-9',
    ],
  }).stdout.trim();

describe('vulcan flow step', () => {
  test('changes one step and keeps every other field of the flow line', () => {
    const root = project();
    const id = open(root);
    const done = cli({ root, args: ['step', '--flow', id, '--done', 'Refresh'] });
    const last = linesOf(root).at(-1);

    expect(done.code).toBe(0);
    expect(last?.type).toBe('flow');
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
    expect(last?.ref).toBe('TRK-9');
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

  test('a change that changes nothing writes nothing and prints the line that says it', () => {
    const root = project();
    const id = open(root);
    const before = linesOf(root).length;
    const result = cli({ root, args: ['step', '--flow', id, '--done', 'Token'] });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(linesOf(root).at(-1)?.id as string);
    expect(linesOf(root)).toHaveLength(before);
    cli({ root, args: ['step', '--flow', id, '--next', 'review'] });
    expect(linesOf(root)).toHaveLength(before);
  });

  test('a step of 201 characters and a 31st step are refused, not cut', () => {
    const root = project();
    const id = open(root);
    const long = cli({ root, args: ['step', '--flow', id, '--todo', 'x'.repeat(201)] });

    expect(long.code).not.toBe(0);
    expect(long.stderr).toContain('200');

    const full = cli({
      root,
      args: [
        'add',
        '--type',
        'flow',
        '--flow',
        id,
        '--title',
        'Sign in',
        ...Array.from({ length: 30 }, (_, at) => ['--step', `s${at}`]).flat(),
      ],
    });
    const many = cli({ root, args: ['step', '--flow', id, '--todo', 'one too many'] });

    expect(full.code).toBe(0);
    expect(many.code).not.toBe(0);
    expect(many.stderr).toContain('at most 30');
    expect(linesOf(root).at(-1)?.steps).toHaveLength(30);
  });

  test('--json and a blank --next are refused', () => {
    const root = project();
    const id = open(root);

    expect(cli({ root, args: ['step', '--flow', id, '--done', 'Token', '--json'] }).code).not.toBe(
      0,
    );
    expect(cli({ root, args: ['step', '--flow', id, '--next', '  '] }).code).not.toBe(0);
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
        type: 'commit',
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
  const call = (opts: {
    root: string;
    todos: unknown[];
    env?: Record<string, string>;
    extra?: Record<string, unknown>;
    now?: number;
  }) =>
    EventHook.run({
      root: opts.root,
      input: wire({
        hookEventName: 'PostToolUse',
        toolName: 'TodoWrite',
        sessionId: SESSION,
        cwd: opts.root,
        toolInput: { todos: opts.todos },
        ...opts.extra,
      }),
      env: { VULCAN_ACTOR: 'pnt-vulcan-1', ...opts.env },
      isOver: FlowState.isOver,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
  const task = (content: string, status = 'pending') => ({ content, status, activeForm: 'x' });

  test('a task that is not a step is added, a completed one marks its step done, the rest copied forward', () => {
    const root = project();
    const id = open(root);
    const line = call({
      root,
      todos: [task('Refresh', 'completed'), task('Docs'), task('Done already', 'completed')],
    });

    expect(line?.flowId).toBe(id);
    expect(line?.source).toBe('claude-hook');
    expect(line?.steps).toEqual([
      { text: 'Token', done: true },
      { text: 'Refresh', done: true },
      { text: 'Docs', done: false },
      { text: 'Done already', done: true },
    ]);
    expect(line?.why).toBe('Users cannot sign in');
    expect(line?.checks).toEqual([{ text: 'Signs in', done: false }]);
    expect(line?.ref).toBe('TRK-9');
  });

  test('nothing is removed and no step is reopened, so what event step wrote stays', () => {
    const root = project();
    const id = open(root);

    cli({ root, args: ['step', '--flow', id, '--done', 'Extra by hand'] });

    const line = call({ root, todos: [task('Token'), task('Only this one')] });

    expect(line?.steps).toEqual([
      { text: 'Token', done: true },
      { text: 'Refresh', done: false },
      { text: 'Extra by hand', done: true },
      { text: 'Only this one', done: false },
    ]);
  });

  test('the same list again writes nothing, and an empty one writes nothing', () => {
    const root = project();

    open(root);

    const todos = [task('Brand new')];

    expect(call({ root, todos })).toBeDefined();
    expect(call({ root, todos })).toBeUndefined();
    expect(call({ root, todos: [] })).toBeUndefined();
    expect(linesOf(root).filter((line) => line.source === 'claude-hook')).toHaveLength(1);
  });

  test('a call of a subagent writes nothing', () => {
    const root = project();

    open(root);
    expect(
      call({ root, todos: [task('Review item')], extra: { agentId: 'agent-1' } }),
    ).toBeUndefined();
    expect(call({ root, todos: [task('Review item')] })).toBeDefined();
  });

  test('the flow of the branch is used by any session, and a flow that is over is not written', () => {
    const root = project();
    const id = open(root);
    const other = { VULCAN_ACTOR: 'someone-else' };

    expect(call({ root, todos: [task('A')], env: other })).toBeUndefined();

    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/HEAD'), `ref: refs/heads/feature/${id}-sign-in\n`);
    expect(call({ root, todos: [task('A')], env: other })?.flowId).toBe(id);

    cli({ root, args: ['add', '--type', 'deploy', '--flow', id, '--summary', 'live'] });
    expect(call({ root, todos: [task('B')], env: other })).toBeUndefined();
    expect(call({ root, todos: [task('B')] })).toBeUndefined();
  });

  test('a flow this session opened that is over is skipped, and the search takes the one before it open', () => {
    const root = project();
    const first = open(root);
    const second = open(root);

    cli({ root, args: ['add', '--type', 'deploy', '--flow', second, '--summary', 'live'] });

    expect(call({ root, todos: [task('C')] })?.flowId).toBe(first);
  });

  test('the window is three days: an older flow line is not found, for the branch and for the session', () => {
    const day = 24 * 60 * 60 * 1000;
    const fresh = project();
    const stale = project();

    open(fresh);
    open(stale);
    expect(call({ root: fresh, todos: [task('D')], now: Date.now() + 2 * day })).toBeDefined();
    expect(call({ root: stale, todos: [task('E')], now: Date.now() + 4 * day })).toBeUndefined();
  });

  test('an actor that is not known, a log that is off, no flow and malformed calls write nothing and never throw', () => {
    const none = project();
    const off = project({ log: false });
    const unknown = project();

    open(off);
    open(unknown);

    expect(call({ root: none, todos: [task('a')] })).toBeUndefined();
    expect(call({ root: off, todos: [task('a')] })).toBeUndefined();
    expect(
      EventHook.run({
        root: unknown,
        input: wire({
          hookEventName: 'PostToolUse',
          toolName: 'TodoWrite',
          toolInput: { todos: [task('a')] },
        }),
        env: {},
        isOver: FlowState.isOver,
      }),
    ).toBeUndefined();
    expect(call({ root: unknown, todos: ['x', 4, null, { content: 7 }] })).toBeUndefined();
  });

  test('a step text with a secret is redacted like every text of the log', () => {
    const root = project();

    open(root);

    const line = call({ root, todos: [task('use password=hunter2hunter2 here')] });

    expect(JSON.stringify(line?.steps)).not.toContain('hunter2');
  });
});

describe('the hook script with a task list', () => {
  test('the script loads the flow check itself, writes the merged steps and prints nothing', () => {
    const root = project();
    const id = open(root);
    const child = spawnSyncBounded({
      cmd: [process.execPath, join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'event.ts')],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, VULCAN_ACTOR: 'pnt-vulcan-1' },
      stdin: new TextEncoder().encode(
        JSON.stringify(
          wire({
            hookEventName: 'PostToolUse',
            toolName: 'TodoWrite',
            sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
            cwd: root,
            toolInput: { todos: [{ content: 'From the script', status: 'completed' }] },
          }),
        ),
      ),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const last = linesOf(root).at(-1);

    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toBe('');
    expect(last?.flowId).toBe(id);
    expect(last?.steps?.at(-1)).toEqual({ text: 'From the script', done: true });
  });
});

describe('a flow step keeps the steps it does not name', () => {
  const FIVE = ['One', 'Two', 'Three', 'Four', 'Five'];
  const openFive = (root: string): string =>
    cli({
      root,
      args: [
        'add',
        '--type',
        'flow',
        '--title',
        'Sign in',
        '--step-done',
        'One',
        '--step-done',
        'Two',
        '--step',
        'Three',
        '--step',
        'Four',
        '--step',
        'Five',
      ],
    }).stdout.trim();
  const stepsOf = (root: string): string[] | undefined =>
    linesOf(root)
      .filter((line) => line.type === 'flow')
      .at(-1)
      ?.steps?.map((step) => step.text);

  test('--todo with a new text appends it after five steps and keeps the rest in order', () => {
    const root = project();
    const id = openFive(root);

    cli({ root, args: ['step', '--flow', id, '--todo', 'Six'] });

    expect(stepsOf(root)).toEqual([...FIVE, 'Six']);
  });

  test('--done with a new text appends it done, and --todo with an old text only opens it', () => {
    const root = project();
    const id = openFive(root);

    cli({ root, args: ['step', '--flow', id, '--done', 'Six'] });
    cli({ root, args: ['step', '--flow', id, '--todo', 'One'] });

    const last = linesOf(root)
      .filter((line) => line.type === 'flow')
      .at(-1);

    expect(last?.steps).toEqual([
      { text: 'One', done: false },
      { text: 'Two', done: true },
      { text: 'Three', done: false },
      { text: 'Four', done: false },
      { text: 'Five', done: false },
      { text: 'Six', done: true },
    ]);
  });

  test('two title-only flow lines after five steps leave the list alone, and a step then makes six', () => {
    const root = project();
    const id = openFive(root);

    cli({ root, args: ['add', '--type', 'flow', '--flow', id, '--title', 'Sign in again'] });
    cli({ root, args: ['add', '--type', 'flow', '--flow', id, '--title', 'Sign in once more'] });
    cli({ root, args: ['step', '--flow', id, '--todo', 'Six'] });

    const last = linesOf(root)
      .filter((line) => line.type === 'flow')
      .at(-1);

    expect(last?.summary).toBe('Sign in once more');
    expect(last?.steps?.map((step) => step.text)).toEqual([...FIVE, 'Six']);
    expect(last?.steps?.slice(0, 2).map((step) => step.done)).toEqual([true, true]);
  });

  test('a flow line that carries steps replaces the list, and a title-only line after it keeps that list', () => {
    const root = project();
    const id = openFive(root);

    cli({
      root,
      args: ['add', '--type', 'flow', '--flow', id, '--title', 'Sign in', '--step', 'Only'],
    });
    cli({ root, args: ['add', '--type', 'flow', '--flow', id, '--title', 'Sign in v2'] });
    cli({ root, args: ['step', '--flow', id, '--todo', 'Next'] });

    expect(stepsOf(root)).toEqual(['Only', 'Next']);
  });
});
