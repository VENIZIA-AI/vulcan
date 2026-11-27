import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { GitActivity } from '../../hooks/git-activity.ts';
import type { TGitActivity } from '../../events/index.ts';
import { BoardStop, EventHook, EventLog, FlowState } from '../../events/index.ts';
import type { IEvent } from '../../events/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const T0 = Date.parse('2026-11-23T09:00:00Z');
const MINUTE = 60 * 1000;
const FLOW = 'VULZ-ACME-1';
const ACTOR = 'pnt-vulcan-1';
const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890';
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
      type: 'flow',
      summary: 'Sign in',
      actor: ACTOR,
      source: 'cli',
      flowId: FLOW,
      session: SESSION,
      steps: opts.steps ?? [
        { text: 'Token', done: true },
        { text: 'Refresh', done: false },
      ],
      now: opts.at,
    }),
  });
const line = (opts: {
  root: string;
  type: 'commit' | 'pr' | 'deploy';
  summary: string;
  at: number;
  actor?: string;
}): void =>
  write({
    root: opts.root,
    event: EventLog.build({
      type: opts.type,
      summary: opts.summary,
      actor: opts.actor ?? ACTOR,
      source: 'claude-hook',
      flowId: FLOW,
      now: opts.at,
    }),
  });
const editCall = (opts: {
  root: string;
  actor?: string;
  at: number;
  tool?: string;
  result?: Record<string, unknown>;
}) =>
  EventHook.run({
    root: opts.root,
    input: wire({
      hookEventName: 'PostToolUse',
      toolName: opts.tool ?? 'Edit',
      sessionId: SESSION,
      cwd: opts.root,
      toolInput: {
        filePath: join(opts.root, 'a.txt'),
        oldString: 'secret one',
        newString: 'secret two',
      },
      ...(opts.result === undefined ? {} : { toolResponse: opts.result }),
    }),
    env: { VULCAN_ACTOR: opts.actor ?? ACTOR },
    now: opts.at,
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
    line({ root, type: 'commit', summary: 'commit', at: T0 + 1000 });
    flowLine({ root, at: T0 + 2000 });
    expect(stop({ root })).toBeUndefined();
  });

  test('a commit or a pull request since the flow line holds the turn with the exact commands', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, type: 'commit', summary: 'commit', at: T0 + 1000 });

    const held = stop({ root });

    expect(held?.decision).toBe('block');
    expect(held?.reason).toBe(
      `The board is out of step for ${FLOW}: run bun node_modules/.bin/vulcan flow step --flow '${FLOW}' --next '<what is done, what comes next>'`,
    );
    expect(held?.reason).not.toContain('--done');

    const pr = project();

    flowLine({ root: pr, at: T0 });
    line({ root: pr, type: 'pr', summary: 'pull request opened', at: T0 + 1000 });
    expect(stop({ root: pr })?.decision).toBe('block');
  });

  test('an edit of tracked files since the flow line, after an edit tool of the session, holds it, and no edit does not', () => {
    const root = project();

    flowLine({ root, at: T0 });
    editCall({ root, at: T0 + 31 * MINUTE });
    expect(stop({ root, edited: true, now: T0 + 32 * MINUTE })?.decision).toBe('block');
    expect(stop({ root, edited: false, now: T0 + 32 * MINUTE })).toBeUndefined();
  });

  test('an edit within 30 minutes of the last flow update does not hold, one after 31 minutes does', () => {
    const soon = project();

    flowLine({ root: soon, at: T0 });
    editCall({ root: soon, at: T0 + 10 * MINUTE });
    expect(stop({ root: soon, edited: true, now: T0 + 11 * MINUTE })).toBeUndefined();

    const late = project();

    flowLine({ root: late, at: T0 });
    editCall({ root: late, at: T0 + 31 * MINUTE });
    expect(stop({ root: late, edited: true, now: T0 + 32 * MINUTE })?.decision).toBe('block');
  });

  test('a merge with steps still open holds it', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, type: 'pr', summary: 'pull request merge', at: T0 + 1000 });

    const held = stop({ root });

    expect(held?.reason).toContain(`flow step --flow '${FLOW}' --next`);
    expect(held?.reason).not.toContain('--done');
  });

  test('never twice in a turn, never with the log off, never for another actor or an unknown one, never on a flow that is over', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, type: 'commit', summary: 'commit', at: T0 + 1000 });
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
    line({ root: off, type: 'commit', summary: 'commit', at: T0 + 1000 });
    expect(stop({ root: off })).toBeUndefined();

    line({ root, type: 'deploy', summary: 'live', at: T0 + 2000 });
    expect(stop({ root })).toBeUndefined();
  });

  test('no flow, no flow line, and a broken input end the turn without throwing', () => {
    const none = project();

    line({ root: none, type: 'commit', summary: 'commit', at: T0 + 1000 });
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
    editCall({ root, actor: 'assistant-1', at: T0 + 31 * MINUTE });
    editCall({ root, at: T0 + 31 * MINUTE });

    const now = T0 + 32 * MINUTE;

    expect(stop({ root, actor: 'assistant-1', edited: true, now })).toBeUndefined();
    expect(stop({ root, actor: ACTOR, edited: true, now })?.decision).toBe('block');
  });

  test('a branch flow of another actor holds a session only on its own commit or pull request lines', () => {
    const root = project();

    flowLine({ root, at: T0 });
    branch(root);
    line({ root, type: 'commit', summary: 'commit', at: T0 + 1000, actor: ACTOR });
    expect(stop({ root, actor: 'assistant-1' })).toBeUndefined();

    line({ root, type: 'commit', summary: 'commit', at: T0 + 2000, actor: 'assistant-1' });
    expect(stop({ root, actor: 'assistant-1' })?.decision).toBe('block');
  });
});

describe('an edit counts only when an edit tool of this session ran', () => {
  test('another session that edits files of the flow does not hold this one', () => {
    const root = project();

    flowLine({ root, at: T0 });
    editCall({ root, actor: 'assistant-1', at: T0 + 1000 });
    expect(stop({ root, edited: true })).toBeUndefined();
  });

  test('an edit of this session with no step after it holds once; a step line after it does not hold', () => {
    const root = project();

    flowLine({ root, at: T0 });
    editCall({ root, at: T0 + 31 * MINUTE });
    expect(stop({ root, edited: true, now: T0 + 32 * MINUTE })?.decision).toBe('block');
    expect(stop({ root, edited: true, active: true, now: T0 + 32 * MINUTE })).toBeUndefined();

    flowLine({ root, at: T0 + 33 * MINUTE });
    expect(stop({ root, edited: true, now: T0 + 34 * MINUTE })).toBeUndefined();
  });

  test('no mark, a mark older than the flow line, or an edit tool but no dirty tracked file does not hold', () => {
    const none = project();

    flowLine({ root: none, at: T0 });
    expect(stop({ root: none, edited: true })).toBeUndefined();

    const older = project();

    editCall({ root: older, at: T0 - 1000 });
    flowLine({ root: older, at: T0 });
    expect(stop({ root: older, edited: true })).toBeUndefined();

    const clean = project();

    flowLine({ root: clean, at: T0 });
    editCall({ root: clean, at: T0 + 1000 });
    expect(stop({ root: clean, edited: false })).toBeUndefined();
  });

  test('every edit tool marks the session in a private file of the events folder, and logs no line and no path', () => {
    const folder = (root: string) => join(dirOf(root), '.own-edits');

    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      const root = project();

      expect(editCall({ root, tool, at: T0 })).toBeUndefined();
      expect(readFileSync(join(folder(root), ACTOR), 'utf8')).toBe(String(T0));
      expect(statSync(join(folder(root), ACTOR)).mode % 0o1000).toBe(0o600);
      expect(readdirSync(folder(root))).toEqual([ACTOR]);
      expect(EventLog.read({ dir: dirOf(root) }).events).toHaveLength(0);
    }
  });

  test('a failed call, an unknown actor and the log off mark nothing', () => {
    const root = project();
    const file = join(dirOf(root), '.own-edits', ACTOR);

    editCall({ root, at: T0, result: { success: false } });
    expect(existsSync(file)).toBe(false);
    EventHook.run({
      root,
      input: wire({ hookEventName: 'PostToolUse', toolName: 'Edit', cwd: root }),
      env: {},
      now: T0,
    });
    expect(existsSync(join(dirOf(root), '.own-edits'))).toBe(false);

    const off = project({ log: false });

    editCall({ root: off, at: T0 });
    expect(existsSync(join(dirOf(off), '.own-edits'))).toBe(false);
  });
});

describe('a stale flow is reminded once per two hours', () => {
  const HOUR = 60 * 60 * 1000;

  test('open steps and no work line for two hours hold the turn with the one command', () => {
    const root = project();

    flowLine({ root, at: T0 });

    const held = stop({ root, now: T0 + 3 * HOUR });

    expect(held?.decision).toBe('block');
    expect(held?.reason).toContain(`flow step --flow '${FLOW}' --next`);
    expect(held?.reason).not.toContain('--done');
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
        type: 'usage',
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
    line({ root: worked, type: 'commit', summary: 'commit', at: T0 + 2 * HOUR });
    flowLine({ root: worked, at: T0 + 2 * HOUR + 1000 });
    expect(stop({ root: worked, now: T0 + 3 * HOUR })).toBeUndefined();
  });

  test('a commit alone counts as work: a flow whose last work is a commit an hour ago is not stale', () => {
    const root = project();

    flowLine({ root, at: T0 });
    line({ root, type: 'commit', summary: 'commit', at: T0 + 2 * HOUR + 30 * 60_000 });
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
  ])('%s is %s', (command, type) => {
    expect(GitActivity.classify({ command })).toBe(type);
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

    expect([commit?.type, commit?.summary, commit?.flowId]).toEqual(['commit', 'commit', FLOW]);
    expect([opened?.type, opened?.summary]).toEqual(['pr', 'pull request opened']);
    expect([merged?.type, merged?.summary]).toEqual(['pr', 'pull request merge']);
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
    line({ root, type: 'deploy', summary: 'live', at: Date.now() + 5000 });
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
    expect([last?.type, last?.summary, last?.flowId]).toEqual(['commit', 'commit', FLOW]);
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
    line({ root, type: 'commit', summary: 'commit', at: now - 1000 });

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
    expect(parsed.reason).toContain(`flow step --flow '${FLOW}'`);
    expect(again.stdout.toString()).toBe('');
    expect(run({ script: 'board-stop.ts', root, input: 'not an object' }).exitCode).toBe(0);
  });

  test('an edit through the event script, then a dirty tracked file, holds the stop script; a dirty file alone does not', () => {
    const root = project();
    const git = (...args: string[]) =>
      Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
    const stopInput = { hookEventName: 'Stop', sessionId: SESSION, cwd: root };

    writeFileSync(join(root, 'a.txt'), 'one\n');
    git('init', '-q');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'first');
    flowLine({ root, at: Date.now() - 40 * MINUTE });
    writeFileSync(join(root, 'a.txt'), 'two\n');
    expect(run({ script: 'board-stop.ts', root, input: stopInput }).stdout.toString()).toBe('');

    const edit = run({
      script: 'event.ts',
      root,
      input: {
        hookEventName: 'PostToolUse',
        toolName: 'Edit',
        sessionId: SESSION,
        cwd: root,
        toolInput: { filePath: join(root, 'a.txt') },
      },
    });
    const held = run({ script: 'board-stop.ts', root, input: stopInput });

    expect(edit.exitCode).toBe(0);
    expect(edit.stdout.toString()).toBe('');
    expect(JSON.parse(held.stdout.toString()).decision).toBe('block');
  });
});
