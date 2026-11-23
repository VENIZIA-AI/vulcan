import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { EventLog, FlowState } from '../../events/index.ts';
import { FlowGuard } from '../../hooks/flow-guard.ts';
import { wire } from '../events/wire.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const FLOW = 'VULZ-ACME-1';
const ACTOR = 'pnt-vulcan-1';
const GUARD = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-git.ts');

const project = (opts: { log?: boolean; manifest?: string } = {}): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json':
        opts.manifest ??
        JSON.stringify({ project: { key: 'ACME' }, events: { log: opts.log ?? true } }),
    },
  });
const dirOf = (root: string): string => join(root, '.agents/local/events');
const addLine = (opts: { root: string; kind: 'flow' | 'deploy'; actor?: string; at?: number }) =>
  EventLog.append({
    dir: dirOf(opts.root),
    event: EventLog.build({
      kind: opts.kind,
      summary: 'Sign in',
      actor: opts.actor ?? ACTOR,
      source: 'cli',
      flowId: FLOW,
      ...(opts.at === undefined ? {} : { now: opts.at }),
    }),
  });
const inspect = (opts: { root: string; command: string; actor?: string }) =>
  FlowGuard.inspect({
    root: opts.root,
    command: opts.command,
    cwd: opts.root,
    env: { VULCAN_ACTOR: opts.actor ?? ACTOR },
    isOver: FlowState.isOver,
  });

describe('FlowGuard: a commit or a pull request needs a flow, in a project that logs events', () => {
  test.each([
    'git commit -m "x"',
    'git commit -a -m "x"',
    'git add . && git commit -m "x"',
    'gh pr create --base develop --title t',
    'glab mr create',
  ])('%s with no flow is refused with the command that makes one', (command) => {
    const root = project();
    const [hit] = inspect({ root, command });

    expect(hit?.decision).toBe('deny');
    expect(hit?.rule).toBe('V-P-13');
    expect(hit?.fix).toContain('bun node_modules/.bin/vulcan event add --kind flow --title');
    expect(hit?.fix).toContain('Flow: <id>');
  });

  test.each([
    'git status',
    'git log --grep commit',
    'git commit --dry-run',
    'git push origin x',
    'gh pr view 5',
    'gh pr merge 5 --squash',
    'ls',
  ])('%s is not asked about', (command) => {
    expect(inspect({ root: project(), command })).toEqual([]);
  });

  test('with events.log off, or no manifest, the rule does not exist', () => {
    expect(inspect({ root: project({ log: false }), command: 'git commit -m x' })).toEqual([]);
    expect(
      inspect({ root: project({ manifest: '{ not json' }), command: 'git commit -m x' }),
    ).toEqual([]);
  });

  test('the branch, a flow id in the command, or a flow this session has open resolve it', () => {
    const branch = project();

    mkdirSync(join(branch, '.git'));
    writeFileSync(join(branch, '.git/HEAD'), `ref: refs/heads/feature/${FLOW}-sign-in\n`);
    expect(inspect({ root: branch, command: 'git commit -m x' })).toEqual([]);

    expect(
      inspect({ root: project(), command: `git commit -m "Flow: ${FLOW} fix the thing"` }),
    ).toEqual([]);
    expect(
      inspect({
        root: project(),
        command: `git commit -F - <<'EOF'\nfix the thing\n\nFlow: ${FLOW}\nEOF`,
      }),
    ).toEqual([]);

    const session = project();

    addLine({ root: session, kind: 'flow' });
    expect(inspect({ root: session, command: 'gh pr create --base develop' })).toEqual([]);
  });

  test("another session's flow, and a flow that is over, do not resolve it", () => {
    const other = project();

    addLine({ root: other, kind: 'flow', actor: 'someone-else' });
    expect(inspect({ root: other, command: 'git commit -m x' })).toHaveLength(1);

    const over = project();

    addLine({ root: over, kind: 'flow', at: Date.now() - 2000 });
    addLine({ root: over, kind: 'deploy', at: Date.now() - 1000 });
    expect(inspect({ root: over, command: 'git commit -m x' })).toHaveLength(1);
  });

  test('a flow older than the three days of the window does not resolve it', () => {
    const root = project();

    addLine({ root, kind: 'flow', at: Date.now() - 4 * 24 * 60 * 60 * 1000 });
    expect(inspect({ root, command: 'git commit -m x' })).toHaveLength(1);
  });
});

describe('FlowGuard: what is not asked about, and what fails open', () => {
  test('an id-like word that is not "Flow: <id>" does not resolve it, and the fix says to name an existing flow first', () => {
    const [hit] = inspect({ root: project(), command: 'git commit -m "fix F-35 gear"' });

    expect(hit?.decision).toBe('deny');
    expect(hit?.fix?.startsWith('if this work already has a flow, put "Flow: <id>"')).toBe(true);
    expect(hit?.fix).toContain("--title '<what this work is>'");
  });

  test.each([
    'git -C ../ignis commit -m x',
    'git --git-dir=../ignis/.git commit -m x',
    'cd ../ignis && git commit -m x',
    'gh -R a/b pr create --base develop',
    'gh pr create --repo a/b --base develop',
    'git commit --amend --no-edit',
  ])('%s is not judged by this repository', (command) => {
    expect(inspect({ root: project(), command })).toEqual([]);
  });

  test('a commit that concludes a merge is not asked about', () => {
    const root = project();

    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/develop\n');
    expect(inspect({ root, command: 'git commit -m x' })).toHaveLength(1);
    writeFileSync(join(root, '.git/MERGE_HEAD'), 'abc\n');
    expect(inspect({ root, command: 'git commit -m x' })).toEqual([]);
  });

  test('a session id with no VULCAN_ACTOR names the session, and its own flow resolves it', () => {
    const root = project();
    const sessionId = 'abcdef12-3456-7890-abcd-ef1234567890';
    const ask = () =>
      FlowGuard.inspect({
        root,
        command: 'git commit -m x',
        cwd: root,
        sessionId,
        env: {},
        isOver: FlowState.isOver,
      });

    expect(ask()).toHaveLength(1);
    addLine({ root, kind: 'flow', actor: 'claude:abcdef12' });
    expect(ask()).toEqual([]);
  });

  test('a session whose name is not known is not refused', () => {
    expect(
      FlowGuard.inspect({
        root: project(),
        command: 'git commit -m x',
        cwd: undefined,
        env: {},
        isOver: FlowState.isOver,
      }),
    ).toEqual([]);
  });

  test('a log that cannot be read is no refusal', () => {
    const root = project();

    mkdirSync(join(root, '.agents/local'), { recursive: true });
    writeFileSync(join(root, '.agents/local/events'), 'not a folder');
    expect(inspect({ root, command: 'git commit -m x' })).toEqual([]);
  });
});

describe('the git guard script holds the rule', () => {
  const run = (opts: { root: string; command: string; env?: Record<string, string> }) =>
    spawnSyncBounded({
      cmd: [process.execPath, GUARD],
      cwd: opts.root,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: opts.root,
        VULCAN_ACTOR: ACTOR,
        ...opts.env,
      },
      stdin: new TextEncoder().encode(
        JSON.stringify(
          wire({
            hookEventName: 'PreToolUse',
            toolName: 'Bash',
            sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
            cwd: opts.root,
            toolInput: { command: opts.command },
          }),
        ),
      ),
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test('a commit with no flow is denied with the rule, the reason and the command', () => {
    const root = project();
    const child = run({ root, command: 'git commit -m "x"' });
    const out = JSON.parse(child.stdout.toString());

    expect(child.exitCode).toBe(0);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('V-P-13');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('event add --kind flow');
  });

  test('with a flow, with the log off and for a command that is not a commit it prints nothing', () => {
    const open = project();

    addLine({ root: open, kind: 'flow' });
    expect(run({ root: open, command: 'git commit -m "x"' }).stdout.toString()).toBe('');
    expect(
      run({ root: project({ log: false }), command: 'git commit -m "x"' }).stdout.toString(),
    ).toBe('');
    expect(run({ root: project(), command: 'git status' }).stdout.toString()).toBe('');
    expect(run({ root: project(), command: 'ls' }).stdout.toString()).toBe('');
  });

  test('a commit in another repository, an amend and a heredoc message with the flow print nothing', () => {
    const root = project();

    expect(run({ root, command: 'git -C ../x commit -m "x"' }).stdout.toString()).toBe('');
    expect(run({ root, command: 'git commit --amend --no-edit' }).stdout.toString()).toBe('');
    expect(
      run({ root, command: `git commit -F - <<'EOF'\nx\n\nFlow: ${FLOW}\nEOF` }).stdout.toString(),
    ).toBe('');
  });

  test('VULCAN_GUARDS=off lets it through', () => {
    const child = run({
      root: project(),
      command: 'git commit -m "x"',
      env: { VULCAN_GUARDS: 'off' },
    });

    expect(child.stdout.toString()).toBe('');
  });
});
