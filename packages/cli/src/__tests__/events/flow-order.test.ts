import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { join } from 'node:path';
import { BoardFold } from '../../board/fold.ts';
import { EventLog, FlowSteps } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);
setDefaultTimeout(30_000);

const project = (): string =>
  createProject({
    files: {
      '.agents/local/vulcan.manifest.json': JSON.stringify({
        project: { key: 'ACME' },
        events: { log: true },
      }),
    },
  });
const cli = (opts: { root: string; args: string[] }) =>
  runCli({
    args: opts.args,
    cwd: opts.root,
    env: { ...hermeticEnv(), VULCAN_ACTOR: 'pnt-vulcan-1' },
  });
const linesOf = (root: string) => EventLog.read({ dir: join(root, '.agents/local/events') }).events;
const flowsOf = (root: string) =>
  EventLog.read({ dir: join(root, '.agents/local/events') }).events.filter(
    (line) => line.kind === 'flow',
  );
const open = (opts: { root: string; extra?: string[] }): string =>
  cli({
    root: opts.root,
    args: ['flow', 'add', '--title', 'Sign in', '--step', 'Token', ...(opts.extra ?? [])],
  }).stdout.trim();

describe('the order of a flow', () => {
  test('add --order writes it on the flow line, and a flow with none has none', () => {
    const root = project();

    open({ root, extra: ['--order', '3'] });
    open({ root });

    expect(flowsOf(root).map((line) => line.order)).toEqual([3, undefined]);
  });

  test('the last value wins, on add and on step', () => {
    const root = project();
    const id = open({ root, extra: ['--order', '2', '--order', '7'] });

    expect(flowsOf(root).at(-1)?.order).toBe(7);

    cli({ root, args: ['flow', 'step', '--flow', id, '--order', '4', '--order', '5'] });
    expect(flowsOf(root).at(-1)?.order).toBe(5);
  });

  test('step --order changes only the order, and the line keeps its steps and title', () => {
    const root = project();
    const id = open({ root, extra: ['--order', '1'] });
    const done = cli({ root, args: ['flow', 'step', '--flow', id, '--order', '6'] });
    const last = flowsOf(root).at(-1);

    expect(done.code).toBe(0);
    expect(last?.order).toBe(6);
    expect(last?.summary).toBe('Sign in');
    expect(last?.steps).toEqual([{ text: 'Token', done: false }]);
  });

  test('a step or a next text keeps the order, and the same order again writes nothing', () => {
    const root = project();
    const id = open({ root, extra: ['--order', '3'] });

    cli({ root, args: ['flow', 'step', '--flow', id, '--done', 'Token'] });
    cli({ root, args: ['flow', 'step', '--flow', id, '--next', 'review'] });
    expect(flowsOf(root).at(-1)?.order).toBe(3);

    const before = flowsOf(root).length;

    cli({ root, args: ['flow', 'step', '--flow', id, '--order', '3'] });
    expect(flowsOf(root)).toHaveLength(before);
  });

  test('--order none clears it', () => {
    const root = project();
    const id = open({ root, extra: ['--order', '3'] });
    const cleared = cli({ root, args: ['flow', 'step', '--flow', id, '--order', 'none'] });

    expect(cleared.code).toBe(0);
    expect(flowsOf(root).at(-1)?.order).toBeNull();
    expect(flowsOf(root).at(-1)?.steps).toEqual([{ text: 'Token', done: false }]);
  });

  test('a retitle without --order keeps the order, --order none clears it, and a retitle after that stays cleared', () => {
    const root = project();
    const id = open({ root, extra: ['--order', '3'] });
    const orderOf = () => linesOf(root).filter((line) => line.flowId === id);

    cli({ root, args: ['flow', 'add', '--flow', id, '--title', 'Sign in again'] });
    cli({ root, args: ['flow', 'step', '--flow', id, '--done', 'Token'] });

    expect(FlowSteps.lastLine({ events: linesOf(root), flowId: id })?.order).toBe(3);

    const board = BoardFold.fold({
      events: BoardFold.fromLog({ events: linesOf(root) }).events,
      owner: 'Ana',
    });

    expect(board.flows.find((flow) => flow.id === id)?.order).toBe(3);

    cli({ root, args: ['flow', 'add', '--flow', id, '--title', 'Sign in v3', '--order', 'none'] });
    expect(orderOf().at(-1)?.order).toBeNull();

    cli({ root, args: ['flow', 'add', '--flow', id, '--title', 'Sign in v4'] });
    cli({ root, args: ['flow', 'step', '--flow', id, '--todo', 'More'] });

    const after = BoardFold.fold({
      events: BoardFold.fromLog({ events: linesOf(root) }).events,
      owner: 'Ana',
    });

    expect(after.flows.find((flow) => flow.id === id)?.order).toBeUndefined();
    expect(orderOf().at(-1)?.order).not.toBe(3);
  });

  test('--order none on a new flow is refused, and on a flow with no order it writes nothing', () => {
    const root = project();

    expect(cli({ root, args: ['flow', 'add', '--title', 'X', '--order', 'none'] }).code).toBe(2);
    expect(flowsOf(root)).toHaveLength(0);

    const id = open({ root });
    const before = flowsOf(root).length;

    expect(cli({ root, args: ['flow', 'step', '--flow', id, '--order', 'none'] }).code).toBe(0);
    expect(flowsOf(root)).toHaveLength(before);
  });

  test('a value that is not a positive whole number is refused, and so is --order on another line', () => {
    const root = project();
    const id = open({ root });

    for (const value of ['0', '-1', '1.5', 'abc', '']) {
      expect(cli({ root, args: ['flow', 'step', '--flow', id, '--order', value] }).code).toBe(2);
    }

    expect(cli({ root, args: ['flow', 'add', '--title', 'X', '--order', 'abc'] }).code).toBe(2);
    expect(
      cli({ root, args: ['event', 'add', '--kind', 'note', '--summary', 'x', '--order', '2'] })
        .code,
    ).toBe(2);
    expect(flowsOf(root)).toHaveLength(1);
  });
});

describe('the order in the log', () => {
  test('an old line with no order is valid, and a line keeps a valid order through the file', () => {
    const old = EventLog.parse({
      line: JSON.stringify({
        id: 'a',
        ts: '2026-11-01T08:00:00.000Z',
        actor: 'x',
        kind: 'flow',
        source: 'cli',
        summary: 'Old',
        flowId: 'F-1',
      }),
    });

    expect(old?.summary).toBe('Old');
    expect(old?.order).toBeUndefined();

    const kept = EventLog.parse({
      line: JSON.stringify(
        EventLog.build({ kind: 'flow', summary: 'New', actor: 'x', source: 'cli', order: 5 }),
      ),
    });

    expect(kept?.order).toBe(5);
  });

  test('an order that is not a positive whole number is dropped, and the line stays a line', () => {
    for (const order of [0, -2, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(
        EventLog.build({ kind: 'flow', summary: 'A', actor: 'x', source: 'cli', order }).order,
      ).toBeUndefined();
    }

    const parsed = EventLog.parse({
      line: JSON.stringify({
        id: 'a',
        ts: '2026-11-01T08:00:00.000Z',
        actor: 'x',
        kind: 'flow',
        source: 'cli',
        summary: 'A',
        order: '3',
      }),
    });

    expect(parsed?.summary).toBe('A');
    expect(parsed?.order).toBeUndefined();
  });
});
