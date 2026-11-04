import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { EventLog } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const project = (): string =>
  createProject({
    files: { '.agents/vulcan.manifest.json': JSON.stringify({ project: { key: 'ACME' } }) },
  });
const events = (root: string) => join(root, '.agents/local/events');
const cli = (opts: { root: string; args: string[] }) =>
  runCli({
    args: ['event', ...opts.args],
    cwd: opts.root,
    env: { ...hermeticEnv(), VULCAN_ACTOR: 'pnt-vulcan-1' },
  });
const flow = (opts: { root: string; extra: string[] }) =>
  cli({ root: opts.root, args: ['add', '--kind', 'flow', '--title', 'Sign in', ...opts.extra] });

describe('the lists of a flow line', () => {
  test('steps, checks and apps are written in the order the flags came, with their state, and the due date and the ref', () => {
    const root = project();
    const result = flow({
      root,
      extra: [
        '--step-done',
        'Socket takes the token',
        '--step',
        'Refresh in the network service',
        '--step-done',
        'Logout clears the session',
        '--check',
        'Sign in, and the token renews on its own',
        '--check-done',
        'Sign out leaves no old session',
        '--app',
        'web-sale',
        '--app',
        'admin',
        '--due',
        '2026-11-08',
        '--ref',
        'PLANE-3054',
      ],
    });

    expect(result.code, result.stderr).toBe(0);

    const [line] = EventLog.read({ dir: events(root) }).events;

    expect(line.steps).toEqual([
      { text: 'Socket takes the token', done: true },
      { text: 'Refresh in the network service', done: false },
      { text: 'Logout clears the session', done: true },
    ]);
    expect(line.checks).toEqual([
      { text: 'Sign in, and the token renews on its own', done: false },
      { text: 'Sign out leaves no old session', done: true },
    ]);
    expect(line.apps).toEqual(['web-sale', 'admin']);
    expect(line.due).toBe('2026-11-08');
    expect(line.ref).toBe('PLANE-3054');
  });

  test('a flow line with no lists has none: an old line stays as it was', () => {
    const root = project();

    expect(flow({ root, extra: ['--next', 'agent-a opens the pull request'] }).code).toBe(0);

    const [line] = EventLog.read({ dir: events(root) }).events;

    expect(line.steps).toBeUndefined();
    expect(line.checks).toBeUndefined();
    expect(line.apps).toBeUndefined();
    expect(line.due).toBeUndefined();
  });

  test.each([
    ['a step that is blank', ['--step', '   ']],
    ['a step over 200 characters', ['--step', 'x'.repeat(201)]],
    ['a check over 200 characters', ['--check-done', 'x'.repeat(201)]],
    ['an app over 40 characters', ['--app', 'x'.repeat(41)]],
    ['31 steps', Array.from({ length: 31 }, (_, index) => ['--step', `s${index}`]).flat()],
    ['13 apps', Array.from({ length: 13 }, (_, index) => ['--app', `a${index}`]).flat()],
    ['a due date that is not a day', ['--due', '08/11/2026']],
    ['a due date that does not exist', ['--due', '2026-02-30']],
    ['a flag with no value', ['--step']],
  ])('%s is refused, and nothing is written', (_name, extra) => {
    const root = project();
    const result = flow({ root, extra });

    expect(result.code).toBe(2);
    expect(EventLog.read({ dir: events(root) }).events).toEqual([]);
  });

  test('30 steps and 12 apps are the most there is, and are accepted', () => {
    const root = project();
    const extra = [
      ...Array.from({ length: 30 }, (_, index) => ['--step', `s${index}`]).flat(),
      ...Array.from({ length: 12 }, (_, index) => ['--app', `a${index}`]).flat(),
    ];

    expect(flow({ root, extra }).code).toBe(0);
  });

  test('the lists and the due date belong to a flow line: another kind refuses them', () => {
    const root = project();

    for (const extra of [
      ['--step', 'x'],
      ['--check-done', 'x'],
      ['--app', 'x'],
      ['--due', '2026-11-08'],
    ]) {
      const result = cli({ root, args: ['add', '--kind', 'commit', '--summary', 'x', ...extra] });

      expect(result.code, extra.join(' ')).toBe(2);
      expect(result.stderr).toContain('flow line only');
    }
  });

  test('a secret in a step is redacted, as in every other text of the log', () => {
    const root = project();

    flow({ root, extra: ['--step', 'rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789 now'] });

    expect(JSON.stringify(EventLog.read({ dir: events(root) }).events[0].steps)).not.toContain(
      'ghp_abcdefgh',
    );
  });
});

describe('reading a line the way it is on disk', () => {
  const parse = (value: object) =>
    EventLog.parse({
      line: JSON.stringify({
        id: 'x',
        ts: '2026-11-04T09:00:00Z',
        actor: 'a',
        kind: 'flow',
        summary: 's',
        source: 'cli',
        ...value,
      }),
    });

  test('what is not a list of items is dropped, the rest is cleaned and cut, and a bad due date is a line that is not an event', () => {
    const event = parse({
      steps: [{ text: 'ok', done: true }, 'not an item', { text: 5 }, { text: 'x'.repeat(400) }],
      checks: 'nope',
      apps: ['a', 5, 'b'],
    });

    expect(event?.steps).toHaveLength(2);
    expect(event?.steps?.[1].text).toHaveLength(200);
    expect(event?.steps?.[0]).toEqual({ text: 'ok', done: true });
    expect(event?.checks).toBeUndefined();
    expect(event?.apps).toEqual(['a', 'b']);
    expect(parse({ due: 'next week' })).toBeUndefined();
  });
});

describe('the deploy kind and the model of a session', () => {
  test('a deploy line is a line of its flow, like a merge', () => {
    const root = project();
    const made = flow({ root, extra: [] }).stdout.trim();
    const result = cli({
      root,
      args: ['add', '--kind', 'deploy', '--summary', 'block 10', '--flow', made],
    });

    expect(result.code, result.stderr).toBe(0);
    expect(EventLog.read({ dir: events(root) }).events.map((event) => event.kind)).toEqual([
      'flow',
      'deploy',
    ]);
  });
});
