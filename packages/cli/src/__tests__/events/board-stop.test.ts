import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { GitActivity } from '../../hooks/git-activity.ts';
import type { TGitActivity } from '../../events/index.ts';
import { BoardStop, EventHook, EventLog, FlowState } from '../../events/index.ts';
import type { IEvent } from '../../events/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const T0 = Date.parse('2026-11-23T09:00:00Z');
const FLOW = 'VULZ-ACME-1';
const ACTOR = 'pnt-vulcan-1';
const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');

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
const write = (opts: { root: string; event: IEvent }): void => {
  EventLog.append({ dir: dirOf(opts.root), event: opts.event });
};
const flowLine = (opts: {
  root: string;
  at: number;
  steps?: { text: string; done: boolean }[];
}): void =>
  write({
    root: opts.root,
    event: EventLog.build({
      kind: 'flow',
      summary: 'Sign in',
      actor: ACTOR,
      source: 'cli',
      flowId: FLOW,
      steps: opts.steps ?? [
        { text: 'Token', done: true },
        { text: 'Refresh', done: false },
      ],
      now: opts.at,
    }),
  });
const line = (opts: {
  root: string;
  kind: 'commit' | 'pr' | 'deploy';
  summary: string;
  at: number;
  actor?: string;
}): void =>
  write({
    root: opts.root,
    event: EventLog.build({
      kind: opts.kind,
      summary: opts.summary,
      actor: opts.actor ?? ACTOR,
      source: 'claude-hook',
      flowId: FLOW,
      now: opts.at,
    }),
  });
const stop = (opts: {
  root: string;
  active?: boolean;
  edited?: boolean;
  actor?: string;
  now?: number;
}) =>
  BoardStop.decide({
    root: opts.root,
    input: wire({
      hookEventName: 'Stop',
      sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
      cwd: opts.root,
      stopHookActive: opts.active ?? false,
    }),
    env: { VULCAN_ACTOR: opts.actor ?? ACTOR },
    isOver: FlowState.isOver,
    edited: () => opts.edited ?? false,
    now: opts.now ?? T0 + 60_000,
  });

describe('the Stop hook decides', () => {
  test('a quiet turn, and a turn after the flow line, end', () => {
    const root = project();

    flowLine({ root, at: T0 });
    expect(stop({ root })).toBeUndefined();
    line({ root, kind: 'commit', summary: 'commit', at: T0 + 1000 });
    flowLine({ root, at: T0 + 2000 });
    expect(stop({ root })).toBeUndefined();
  });

  test('a commit or a pull request since the flow line holds the turn with the exact commands', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, kind: 'commit', summary: 'commit', at: T0 + 1000 });

    const held = stop({ root });

    expect(held?.decision).toBe('block');
    expect(held?.reason).toContain(
      `bun node_modules/.bin/vulcan event step --flow '${FLOW}' --done 'Refresh'`,
    );
    expect(held?.reason).toContain(`event step --flow '${FLOW}' --next with the real state`);
    expect(held?.reason).not.toContain('where the work stands');
    expect(held?.reason).not.toContain("--done 'Token'");

    const pr = project();

    flowLine({ root: pr, at: T0 });
    line({ root: pr, kind: 'pr', summary: 'pull request opened', at: T0 + 1000 });
    expect(stop({ root: pr })?.decision).toBe('block');
  });

  test('an edit of tracked files since the flow line holds it, and no edit does not', () => {
    const root = project();

    flowLine({ root, at: T0 });
    expect(stop({ root, edited: true })?.decision).toBe('block');
    expect(stop({ root, edited: false })).toBeUndefined();
  });

  test('a merge with steps still open holds it and names the open steps', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, kind: 'pr', summary: 'pull request merge', at: T0 + 1000 });

    const held = stop({ root });

    expect(held?.reason).toContain('was merged and steps are still open');
    expect(held?.reason).toContain("--done 'Refresh'");
  });

  test('at most five open steps are listed, a quote in a step is closed and reopened', () => {
    const root = project();

    flowLine({
      root,
      at: T0,
      steps: [
        ...Array.from({ length: 6 }, (_, at) => ({ text: `step ${at}`, done: false })),
        { text: "it's quoted", done: false },
      ],
    });
    line({ root, kind: 'commit', summary: 'commit', at: T0 + 1000 });

    const reason = stop({ root })?.reason ?? '';

    expect(reason.match(/--done/g)).toHaveLength(5);
    expect(reason).toContain('2 more open steps');

    const quoted = project();

    flowLine({ root: quoted, at: T0, steps: [{ text: "it's quoted", done: false }] });
    line({ root: quoted, kind: 'commit', summary: 'commit', at: T0 + 1000 });
    expect(stop({ root: quoted })?.reason).toContain(`--done 'it'\\''s quoted'`);
  });

  test('never twice in a turn, never with the log off, never for another actor or an unknown one, never on a flow that is over', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, kind: 'commit', summary: 'commit', at: T0 + 1000 });
    expect(stop({ root, active: true })).toBeUndefined();
    expect(stop({ root, actor: 'someone-else' })).toBeUndefined();
    expect(
      BoardStop.decide({
        root,
        input: wire({ hookEventName: 'Stop', cwd: root }),
        env: {},
        isOver: FlowState.isOver,
        edited: () => true,
        now: T0 + 60_000,
      }),
    ).toBeUndefined();

    const off = project({ log: false });

    flowLine({ root: off, at: T0 });
    line({ root: off, kind: 'commit', summary: 'commit', at: T0 + 1000 });
    expect(stop({ root: off })).toBeUndefined();

    line({ root, kind: 'deploy', summary: 'live', at: T0 + 2000 });
    expect(stop({ root })).toBeUndefined();
  });

  test('no flow, no flow line, and a broken input end the turn without throwing', () => {
    const none = project();

    line({ root: none, kind: 'commit', summary: 'commit', at: T0 + 1000 });
    expect(stop({ root: none, edited: true })).toBeUndefined();
    expect(
      BoardStop.decide({ root: none, input: 'x', env: {}, isOver: FlowState.isOver }),
    ).toBeUndefined();
    expect(BoardStop.editedSince({ root: join(none, 'nope'), since: 0 })).toBe(false);
  });
});

describe('the edit signal belongs to a session that is in the flow', () => {
  const branch = (root: string): void => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/HEAD'), `ref: refs/heads/feature/${FLOW}-sign-in\n`);
  };

  test('dirty files in a shared checkout do not hold a session that has no line in the flow', () => {
    const root = project();

    flowLine({ root, at: T0 });
    branch(root);
    expect(stop({ root, actor: 'assistant-1', edited: true })).toBeUndefined();
    expect(stop({ root, actor: ACTOR, edited: true })?.decision).toBe('block');
  });

  test('a branch flow of another actor holds a session only on its own commit or pull request lines', () => {
    const root = project();

    flowLine({ root, at: T0 });
    branch(root);
    line({ root, kind: 'commit', summary: 'commit', at: T0 + 1000, actor: ACTOR });
    expect(stop({ root, actor: 'assistant-1' })).toBeUndefined();

    line({ root, kind: 'commit', summary: 'commit', at: T0 + 2000, actor: 'assistant-1' });
    expect(stop({ root, actor: 'assistant-1' })?.decision).toBe('block');
  });
});

describe('a stale flow is reminded once per two hours', () => {
  const HOUR = 60 * 60 * 1000;

  test('open steps and no work line for two hours hold the turn, with the hours and the commands', () => {
    const root = project();

    flowLine({ root, at: T0 });

    const held = stop({ root, now: T0 + 3 * HOUR });

    expect(held?.decision).toBe('block');
    expect(held?.reason).toContain('no update for 3 hours and steps are still open');
    expect(held?.reason).toContain(`event step --flow '${FLOW}' --done 'Refresh'`);
    expect(stop({ root, now: T0 + HOUR })).toBeUndefined();
  });

  test('no nag: once reminded, the session is left alone for two hours, then reminded again', () => {
    const root = project();

    flowLine({ root, at: T0 });
    expect(stop({ root, now: T0 + 3 * HOUR })?.decision).toBe('block');
    expect(stop({ root, now: T0 + 3 * HOUR + 60_000 })).toBeUndefined();
    expect(stop({ root, now: T0 + 4 * HOUR })).toBeUndefined();
    expect(stop({ root, now: T0 + 5 * HOUR + 60_000 })?.decision).toBe('block');
  });

  test('a line of work resets it; a usage line, which the Stop hook writes itself, does not', () => {
    const root = project();

    flowLine({ root, at: T0 });
    write({
      root,
      event: EventLog.build({
        kind: 'usage',
        summary: 'tokens',
        actor: ACTOR,
        source: 'claude-hook',
        flowId: FLOW,
        now: T0 + 2 * HOUR + 59 * 60_000,
      }),
    });
    expect(stop({ root, now: T0 + 3 * HOUR })?.decision).toBe('block');

    const worked = project();

    flowLine({ root: worked, at: T0 });
    line({ root: worked, kind: 'commit', summary: 'commit', at: T0 + 2 * HOUR });
    flowLine({ root: worked, at: T0 + 2 * HOUR + 1000 });
    expect(stop({ root: worked, now: T0 + 3 * HOUR })).toBeUndefined();
  });

  test('a commit alone counts as work: a flow whose last work is a commit an hour ago is not stale', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, kind: 'commit', summary: 'commit', at: T0 + 2 * HOUR + 30 * 60_000 });
    // The commit also holds this turn on its own (no flow line since); the stale reminder is not the reason.
    const held = stop({ root, now: T0 + 3 * HOUR });

    expect(held?.reason ?? '').not.toContain('no update for');
  });

  test('the reminder file is private, named by the actor, and old ones are removed when a new one is written', () => {
    const root = project();
    const folder = join(dirOf(root), '.stale-reminders');

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'old-actor'), '1');
    utimesSync(join(folder, 'old-actor'), 1, 1);
    flowLine({ root, at: T0 });
    expect(stop({ root, now: T0 + 3 * HOUR })?.decision).toBe('block');
    expect(statSync(join(folder, ACTOR)).mode % 0o1000).toBe(0o600);
    expect(existsSync(join(folder, 'old-actor'))).toBe(false);
  });

  test('no open step, a session with no line in the flow, and an active hook are left alone', () => {
    const done = project({});

    flowLine({ root: done, at: T0, steps: [{ text: 'A', done: true }] });
    expect(stop({ root: done, now: T0 + 3 * HOUR })).toBeUndefined();

    const root = project();

    flowLine({ root, at: T0 });
    expect(stop({ root, actor: 'assistant-1', now: T0 + 3 * HOUR })).toBeUndefined();
    expect(stop({ root, active: true, now: T0 + 3 * HOUR })).toBeUndefined();
  });
});

describe('BoardStop.editedSince in a real repository', () => {
  const git = (root: string, ...args: string[]) =>
    Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test('a tracked file changed after the time counts, an untouched tree and an older time do not', () => {
    const root = createProject({ files: { 'a.txt': 'one\n', 'sub/b.txt': 'two\n' } });

    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'first');
    expect(BoardStop.editedSince({ root, since: 0 })).toBe(false);

    writeFileSync(join(root, 'a.txt'), 'changed\n');
    expect(BoardStop.editedSince({ root, since: 0 })).toBe(true);
    expect(BoardStop.editedSince({ root, since: Date.now() + 60_000 })).toBe(false);
    // An untracked file is not an edit of the project's tracked files.
    git(root, 'checkout', '-q', '--', 'a.txt');
    writeFileSync(join(root, 'new.txt'), 'x\n');
    expect(BoardStop.editedSince({ root, since: 0 })).toBe(false);
  });

  test('a folder that is not a repository, or one with no commit, is no edit', () => {
    const plain = createProject({ files: { 'a.txt': 'x\n' } });
    const empty = createProject({ files: {} });

    git(empty, 'init', '-q');
    expect(BoardStop.editedSince({ root: plain, since: 0 })).toBe(false);
    expect(BoardStop.editedSince({ root: empty, since: 0 })).toBe(false);
  });
});

describe('GitActivity.classify', () => {
  test.each<[string, TGitActivity]>([
    ['git commit -m "x"', 'commit'],
    ['git -C sub commit --amend', 'commit'],
    ['cd x && git add . && git commit -m "x"', 'commit'],
    ['gh pr create --base develop --title t', 'pr-open'],
    ['gh -R a/b pr create', 'pr-open'],
    ['glab mr create', 'pr-open'],
    ['gh pr merge 5 --squash', 'pr-merge'],
    ['glab mr merge 5', 'pr-merge'],
  ])('%s is %s', (command, kind) => {
    expect(GitActivity.classify({ command })).toBe(kind);
  });

  test.each([
    'git status',
    'git log --grep commit',
    'git commit --dry-run',
    'git commit --help',
    'gh pr view 5',
    'gh pr create --help',
    'gh pr merge 5 --auto',
    'gh pr merge 5 --squash --auto',
    'glab mr merge 5 --when-pipeline-succeeds',
    'echo git commit',
    'ls',
  ])('%s is nothing', (command) => {
    expect(GitActivity.classify({ command })).toBeUndefined();
  });
});

describe('the Bash line of the event hook', () => {
  const bash = (opts: {
    root: string;
    activity?: TGitActivity;
    env?: Record<string, string>;
    result?: Record<string, unknown>;
  }) =>
    EventHook.run({
      root: opts.root,
      input: wire({
        hookEventName: 'PostToolUse',
        toolName: 'Bash',
        sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
        cwd: opts.root,
        toolInput: { command: 'git commit -m "a secret message"' },
        ...(opts.result === undefined ? {} : { toolResponse: opts.result }),
      }),
      env: { VULCAN_ACTOR: ACTOR, ...opts.env },
      isOver: FlowState.isOver,
      ...(opts.activity === undefined ? {} : { activity: opts.activity }),
    });

  test('a commit, a pull request and a merge are lines with fixed labels on the flow the session last opened', () => {
    const root = project();

    flowLine({ root, at: Date.now() });

    const commit = bash({ root, activity: 'commit' });
    const opened = bash({ root, activity: 'pr-open' });
    const merged = bash({ root, activity: 'pr-merge' });

    expect([commit?.kind, commit?.summary, commit?.flowId]).toEqual(['commit', 'commit', FLOW]);
    expect([opened?.kind, opened?.summary]).toEqual(['pr', 'pull request opened']);
    expect([merged?.kind, merged?.summary]).toEqual(['pr', 'pull request merge']);
    expect(JSON.stringify([commit, opened, merged])).not.toContain('secret');
  });

  test('a failed or interrupted call, and a flow that is over, write nothing', () => {
    const root = project();

    flowLine({ root, at: Date.now() });
    expect(bash({ root, activity: 'commit', result: { interrupted: true } })).toBeUndefined();
    expect(bash({ root, activity: 'commit', result: { exitCode: 1 } })).toBeUndefined();
    expect(bash({ root, activity: 'commit', result: { success: false } })).toBeUndefined();
    expect(
      bash({ root, activity: 'commit', result: { stdout: 'ok', interrupted: false } }),
    ).toBeDefined();

    // The branch names the flow, and it is over: nothing is written on it. With no branch, the search skips it and the line has no flow.
    line({ root, kind: 'deploy', summary: 'live', at: Date.now() + 5000 });
    expect(bash({ root, activity: 'commit' })?.flowId).toBeUndefined();
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/HEAD'), `ref: refs/heads/feature/${FLOW}-sign-in\n`);
    expect(bash({ root, activity: 'commit' })).toBeUndefined();
  });

  test('a call with no class writes nothing, and with no flow the line is kept without one', () => {
    const root = project();

    expect(bash({ root })).toBeUndefined();
    expect(bash({ root, activity: 'commit' })?.flowId).toBeUndefined();
  });
});

describe('the scripts', () => {
  const run = (opts: { script: string; root: string; input: unknown }) =>
    spawnSyncBounded({
      cmd: [process.execPath, join(HOOKS, opts.script)],
      cwd: opts.root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, VULCAN_ACTOR: ACTOR },
      stdin: new TextEncoder().encode(JSON.stringify(wire(opts.input))),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  const bashCall = (root: string, command: string) => ({
    hookEventName: 'PostToolUse',
    toolName: 'Bash',
    sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
    cwd: root,
    toolInput: { command },
  });

  test('a git commit through the event script is a commit line; the command is nowhere in the log', () => {
    const root = project();

    flowLine({ root, at: Date.now() });

    const child = run({
      script: 'event.ts',
      root,
      input: bashCall(root, 'git commit -m "a secret message"'),
    });
    const last = EventLog.read({ dir: dirOf(root) }).events.at(-1);

    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toBe('');
    expect([last?.kind, last?.summary, last?.flowId]).toEqual(['commit', 'commit', FLOW]);
    expect(JSON.stringify(EventLog.read({ dir: dirOf(root) }).events)).not.toContain('secret');
  });

  test('a shell call that is not git writes nothing', () => {
    const root = project();

    flowLine({ root, at: Date.now() });
    run({ script: 'event.ts', root, input: bashCall(root, 'ls -la') });
    run({ script: 'event.ts', root, input: bashCall(root, 'git status') });
    expect(EventLog.read({ dir: dirOf(root) }).events).toHaveLength(1);
  });

  test('the stop script prints the block, once, and prints nothing for a quiet turn or an active hook', () => {
    const root = project();
    const now = Date.now();

    flowLine({ root, at: now - 5000 });
    line({ root, kind: 'commit', summary: 'commit', at: now - 1000 });

    const input = {
      hookEventName: 'Stop',
      sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
      cwd: root,
    };
    const held = run({ script: 'board-stop.ts', root, input: { ...input, stopHookActive: false } });
    const again = run({ script: 'board-stop.ts', root, input: { ...input, stopHookActive: true } });
    const parsed = JSON.parse(held.stdout.toString());

    expect(held.exitCode).toBe(0);
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain(`event step --flow '${FLOW}'`);
    expect(again.stdout.toString()).toBe('');
    expect(run({ script: 'board-stop.ts', root, input: 'not an object' }).exitCode).toBe(0);
  });
});
