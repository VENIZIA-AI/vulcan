import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { ProjectLayout } from '../../common/index.ts';
import { EventConstants, EventHook, EventLog } from '../../events/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const SCRIPT = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'event.ts');
const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890';

const project = (opts: { events?: object; files?: Record<string, string> }): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': JSON.stringify(
        opts.events === undefined ? {} : { events: opts.events },
      ),
      ...opts.files,
    },
  });

const eventsOf = (opts: { dir: string }) => EventLog.read({ dir: opts.dir }).events;

describe('EventHook.map', () => {
  const map = (input: unknown) => EventHook.map({ input: wire(input) });

  test('SessionStart: the source and the model', () => {
    expect(
      map({ hookEventName: 'SessionStart', source: 'resume', model: 'claude-sonnet-5-5' }),
    ).toEqual({
      kind: 'session-start',
      summary: 'resume claude-sonnet-5-5',
      model: 'claude-sonnet-5-5',
    });
    expect(map({ hookEventName: 'SessionStart' })).toEqual({ kind: 'session-start', summary: '' });
  });

  test('Stop: a turn ended, never the reply; a stop hook that is already active is skipped', () => {
    expect(
      map({ hookEventName: 'Stop', stopHookActive: false, lastAssistantMessage: 'SECRET REPLY' }),
    ).toEqual({
      kind: 'session-stop',
      summary: 'turn ended',
    });
    expect(map({ hookEventName: 'Stop', stopHookActive: true })).toBeUndefined();
  });

  test('SubagentStop: the agent type and id, never the reply', () => {
    expect(
      map({
        hookEventName: 'SubagentStop',
        agentType: 'Explore',
        agentId: 'a1-b2',
        lastAssistantMessage: 'SECRET REPLY',
      }),
    ).toEqual({ kind: 'subagent-stop', summary: 'Explore a1-b2' });
  });

  test('Notification: needs-owner for a prompt, nothing for a login that worked; the title, never the message', () => {
    for (const type of ['permission_prompt', 'idle_prompt', 'elicitation_dialog']) {
      expect(
        map({
          hookEventName: 'Notification',
          notificationType: type,
          title: 'Claude needs you',
          message: 'rm -rf /',
        }),
      ).toEqual({
        kind: 'needs-owner',
        summary: 'Claude needs you',
        notification: type,
      });
    }

    expect(map({ hookEventName: 'Notification', notificationType: 'idle_prompt' })).toEqual({
      kind: 'needs-owner',
      summary: 'idle_prompt',
      notification: 'idle_prompt',
    });
    expect(
      map({ hookEventName: 'Notification', notificationType: 'auth_success', title: 't' }),
    ).toBeUndefined();
    expect(map({ hookEventName: 'Notification' })).toBeUndefined();
  });

  test('PostToolUse SendMessage: the recipient in ref, the sender label as the summary, the message body unread', () => {
    const mapped = map({
      hookEventName: 'PostToolUse',
      toolName: 'SendMessage',
      toolInput: {
        to: 'veni-forge',
        summary: 'design note for the event log',
        message: 'Flow: F-9 BODY TEXT',
      },
      toolResponse: { success: true },
    });

    expect(mapped).toMatchObject({
      kind: 'msg-sent',
      summary: 'design note for the event log',
      ref: 'to:veni-forge',
      flowText: 'Flow: F-9 BODY TEXT',
    });
  });

  test('without a label the summary is a fixed text: nothing of the message, its first line included, is stored', () => {
    const mapped = map({
      hookEventName: 'PostToolUse',
      toolName: 'SendMessage',
      toolInput: {
        to: 'x',
        message: 'Edit /home/me/secret-project/packages/api/src/auth.ts now\nsecond line',
      },
    });

    expect(mapped?.summary).toBe('message sent');
    expect(JSON.stringify({ ...mapped, flowText: undefined })).not.toContain('secret-project');
  });

  test('a recipient that is an address keeps its scheme and the last part, not the folders of the machine', () => {
    const refOf = (to: string) =>
      map({
        hookEventName: 'PostToolUse',
        toolName: 'SendMessage',
        toolInput: { to, summary: 's', message: 'm' },
      })?.ref;

    expect(refOf('veni-forge')).toBe('to:veni-forge');
    expect(refOf('worker [3fa9c1]')).toBe('to:worker [3fa9c1]');
    expect(refOf('uds:/run/user/1000/cc-socks/3326301.sock')).toBe('to:uds:3326301.sock');
    expect(refOf('bridge:/home/me/.cache/bridge/abc/def')).toBe('to:bridge:def');
    expect(refOf('/home/me/peer.sock')).toBe('to:peer.sock');
    expect(refOf('uds:C:\\Users\\me\\peer.sock')).toBe('to:uds:peer.sock');
    expect(refOf('uds:/run/x/')).toBe('to:uds:x');
  });

  test('PostToolUse of any other tool is a tick: the fixed text, nothing of the tool, its input or its result', () => {
    const mapped = map({
      hookEventName: 'PostToolUse',
      toolName: 'Bash',
      toolInput: { command: 'cat /home/me/SECRET-PROJECT/.env' },
      toolResponse: { stdout: 'TOKEN-IN-OUTPUT' },
    });

    expect(mapped).toEqual({ kind: 'tool-tick', summary: 'using a tool' });
    expect(JSON.stringify(mapped)).not.toMatch(/SECRET|TOKEN|Bash|cat/);
  });

  test('a failed send and malformed payloads are not logged', () => {
    expect(
      map({
        hookEventName: 'PostToolUse',
        toolName: 'SendMessage',
        toolInput: { to: 'x', message: 'm' },
        toolResponse: { success: false },
      }),
    ).toBeUndefined();
    expect(map({ hookEventName: 'PostToolUse', toolName: 'SendMessage' })).toBeUndefined();
    expect(map({ hookEventName: 'PreToolUse' })).toBeUndefined();
    expect(map(null)).toBeUndefined();
    expect(map('Stop')).toBeUndefined();
    expect(map([])).toBeUndefined();
  });
});

describe('EventHook.run: the tool tick', () => {
  const env = { VULCAN_ACTOR: 'pnt-vulcan-1' };
  const tick = (opts: { root: string; session?: string; at: string }) =>
    EventHook.run({
      root: opts.root,
      input: wire({
        hookEventName: 'PostToolUse',
        toolName: 'Bash',
        sessionId: opts.session ?? SESSION,
      }),
      env,
      now: Date.parse(opts.at),
    });

  test('at most one line per session in 30 seconds, then the next one', () => {
    const root = project({ events: { log: true } });

    expect(tick({ root, at: '2026-11-03T09:00:00Z' })).toMatchObject({ kind: 'tool-tick' });
    expect(tick({ root, at: '2026-11-03T09:00:10Z' })).toBeUndefined();
    expect(tick({ root, at: '2026-11-03T09:00:29Z' })).toBeUndefined();
    expect(tick({ root, at: '2026-11-03T09:00:30Z' })).toMatchObject({ kind: 'tool-tick' });
    expect(tick({ root, at: '2026-11-03T09:00:40Z' })).toBeUndefined();
    expect(eventsOf({ dir: join(root, '.agents/local/events') }).map((event) => event.ts)).toEqual([
      '2026-11-03T09:00:00.000Z',
      '2026-11-03T09:00:30.000Z',
    ]);
  });

  test('two sessions are throttled apart', () => {
    const root = project({ events: { log: true } });

    expect(tick({ root, session: 's-one', at: '2026-11-03T09:00:00Z' })).toBeDefined();
    expect(tick({ root, session: 's-two', at: '2026-11-03T09:00:01Z' })).toBeDefined();
    expect(tick({ root, session: 's-one', at: '2026-11-03T09:00:02Z' })).toBeUndefined();
  });

  test('the stamp is an empty file in the tmp folder of the project, named by the session, and a path in an id cannot leave it', () => {
    const root = project({ events: { log: true } });

    tick({ root, session: '../../evil/id', at: '2026-11-03T09:00:00Z' });

    const folder = join(root, '.agents/local/tmp/event-ticks');

    expect(readdirSync(folder)).toHaveLength(1);
    expect(readFileSync(join(folder, readdirSync(folder)[0]), 'utf8')).toBe('');
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  test('six calls at the same instant write one tick, not several', async () => {
    const root = project({ events: { log: true } });
    const window = EventConstants.TICK_SECONDS * 1000;
    const wait = window - (Date.now() % window);

    // Start just after a window opens, so the six calls cannot straddle two windows.
    await Bun.sleep(wait <= 8000 ? wait + 5 : 0);

    const children = Array.from({ length: 6 }, () =>
      Bun.spawn([process.execPath, SCRIPT], {
        stdin: new TextEncoder().encode(
          JSON.stringify(
            wire({ hookEventName: 'PostToolUse', toolName: 'Bash', sessionId: SESSION }),
          ),
        ),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, VULCAN_ACTOR: 'pnt-vulcan-1' },
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    );

    await Promise.all(children.map((child) => child.exited));

    expect(eventsOf({ dir: join(root, '.agents/local/events') })).toHaveLength(1);
  }, 30_000);

  test('the stamp folder is inside the layout the project keeps its tmp in', () => {
    expect(EventConstants.TICK_FOLDER).toBe(`${ProjectLayout.LOCAL_DIRECTORY}/tmp/event-ticks`);
  });

  test('a stamp from an earlier window is removed by the next tick, so the folder stays small', () => {
    const root = project({ events: { log: true } });
    const folder = join(root, '.agents/local/tmp/event-ticks');

    tick({ root, session: 's-one', at: '2026-11-03T09:00:00Z' });
    tick({ root, session: 's-two', at: '2026-11-03T09:00:10Z' });
    expect(readdirSync(folder)).toHaveLength(2);

    tick({ root, session: 's-one', at: '2026-11-03T09:05:00Z' });
    expect(readdirSync(folder)).toHaveLength(1);
  });

  test('log off writes no line and no stamp', () => {
    const root = project({ events: { log: false } });

    expect(tick({ root, at: '2026-11-03T09:00:00Z' })).toBeUndefined();
    expect(existsSync(join(root, '.agents/local'))).toBe(false);
  });

  test('a SendMessage is still a msg-sent line and is not throttled by the ticks', () => {
    const root = project({ events: { log: true } });

    tick({ root, at: '2026-11-03T09:00:00Z' });

    const sent = EventHook.run({
      root,
      input: wire({
        hookEventName: 'PostToolUse',
        toolName: 'SendMessage',
        sessionId: SESSION,
        toolInput: { to: 'x', summary: 'hi', message: 'm' },
      }),
      env,
      now: Date.parse('2026-11-03T09:00:05Z'),
    });

    expect(sent).toMatchObject({ kind: 'msg-sent' });
  });
});

describe('EventHook.run', () => {
  const env = { VULCAN_ACTOR: 'pnt-vulcan-1' };

  test('log off or manifest missing: nothing is written, nowhere', () => {
    for (const root of [
      project({}),
      project({ events: { log: false } }),
      createProject({ files: {} }),
    ]) {
      expect(
        EventHook.run({
          root,
          input: wire({ hookEventName: 'SessionStart', source: 'startup' }),
          env,
        }),
      ).toBeUndefined();
      expect(existsSync(join(root, '.agents/local/events'))).toBe(false);
    }
  });

  test('log on: one line in the project folder, with the actor, source and the branch flow', () => {
    const root = project({
      events: { log: true },
      files: { '.git/HEAD': 'ref: refs/heads/feature/F-33-events\n' },
    });
    const written = EventHook.run({
      root,
      input: wire({
        hookEventName: 'SessionStart',
        source: 'startup',
        model: 'm',
        sessionId: SESSION,
        cwd: root,
      }),
      env,
      now: Date.parse('2026-11-03T09:30:00Z'),
    });
    const [event] = eventsOf({ dir: join(root, '.agents/local/events') });

    expect(event).toEqual(written!);
    expect(event).toMatchObject({
      kind: 'session-start',
      actor: 'pnt-vulcan-1',
      flowId: 'F-33',
      summary: 'startup m',
      source: 'claude-hook',
    });
  });

  test('the flow of a message wins over the branch', () => {
    const root = project({
      events: { log: true },
      files: { '.git/HEAD': 'ref: refs/heads/feature/F-33-events\n' },
    });

    EventHook.run({
      root,
      input: wire({
        hookEventName: 'PostToolUse',
        toolName: 'SendMessage',
        toolInput: { to: 'veni-forge', summary: 'done', message: 'Flow: F-40 status' },
        cwd: root,
      }),
      env,
    });

    expect(eventsOf({ dir: join(root, '.agents/local/events') })[0]).toMatchObject({
      kind: 'msg-sent',
      flowId: 'F-40',
      ref: 'to:veni-forge',
    });
  });

  test('events.dir sends the line to the shared folder, and the project folder stays empty', () => {
    const shared = createProject({ files: {} });
    const root = project({ events: { log: true, dir: shared } });

    EventHook.run({ root, input: wire({ hookEventName: 'Stop' }), env });

    expect(eventsOf({ dir: shared })).toHaveLength(1);
    expect(existsSync(join(root, '.agents/local/events'))).toBe(false);
  });

  test('nothing of a body, a reply, a command or a path reaches the file', () => {
    const root = project({ events: { log: true } });
    const secrets = [
      'TOP-SECRET-BODY',
      'SECRET-REPLY',
      'SECRET-COMMAND',
      '/etc/shadow-path',
      'SECRET-RESPONSE',
    ];
    const inputs = [
      {
        hookEventName: 'Stop',
        lastAssistantMessage: secrets[1],
        transcriptPath: secrets[3],
        cwd: root,
      },
      {
        hookEventName: 'SubagentStop',
        agentType: 'x',
        agentId: 'y',
        lastAssistantMessage: secrets[1],
        agentTranscriptPath: secrets[3],
      },
      {
        hookEventName: 'Notification',
        notificationType: 'permission_prompt',
        title: 'needs you',
        message: secrets[2],
      },
      {
        hookEventName: 'PostToolUse',
        toolName: 'SendMessage',
        toolInput: {
          to: 'uds:/run/user/1000/secret-dir/peer.sock',
          message: `Flow: F-1 ${secrets[0]} /home/me/private/file.ts`,
        },
        toolResponse: { success: true, detail: secrets[4] },
        transcriptPath: secrets[3],
      },
    ];

    for (const input of inputs) {
      EventHook.run({ root, input: wire(input), env });
    }

    const dir = join(root, '.agents/local/events');
    const text = readdirSync(dir)
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('');

    expect(text.trim().split('\n')).toHaveLength(4);

    for (const secret of [...secrets, '/home/me/private', 'secret-dir', '/run/user']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('the hook script', () => {
  const run = (opts: { root: string; input: string; env?: Record<string, string> }) =>
    spawnSyncBounded({
      cmd: [process.execPath, SCRIPT],
      cwd: opts.root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, VULCAN_ACTOR: 'a-1', ...opts.env },
      stdin: new TextEncoder().encode(opts.input),
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test('writes the line from stdin, prints nothing, exits 0', () => {
    const root = project({ events: { log: true } });
    const result = run({
      root,
      input: JSON.stringify(wire({ hookEventName: 'Stop', sessionId: SESSION, cwd: root })),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('');
    expect(eventsOf({ dir: join(root, '.agents/local/events') })).toHaveLength(1);
  });

  test('fails open: unreadable input, a folder it cannot write and VULCAN_GUARDS=off all exit 0', () => {
    const root = project({ events: { log: true } });
    const garbage = run({ root, input: 'SECRET { not json' });

    expect(garbage.exitCode).toBe(0);
    expect(garbage.stderr.toString()).toContain('unreadable input');
    expect(garbage.stderr.toString()).not.toContain('SECRET');

    const blocked = project({ events: { log: true, dir: '/proc/vulcan-no-such/events' } });
    const unwritable = run({
      root: blocked,
      input: JSON.stringify(wire({ hookEventName: 'Stop' })),
    });

    expect(unwritable.exitCode).toBe(0);
    expect(unwritable.stderr.toString()).toContain('the event hook failed');

    const off = run({
      root,
      input: JSON.stringify(wire({ hookEventName: 'SessionStart' })),
      env: { VULCAN_GUARDS: 'off' },
    });

    expect(off.exitCode).toBe(0);
    expect(eventsOf({ dir: join(root, '.agents/local/events') })).toHaveLength(0);
  });

  test('is fast: the median of 20 runs stays far under a second even on a slow runner', () => {
    const root = project({ events: { log: true } });
    const input = JSON.stringify(wire({ hookEventName: 'Stop', sessionId: SESSION, cwd: root }));
    const times: number[] = [];

    for (let index = 0; index < 20; index++) {
      const started = performance.now();

      run({ root, input });
      times.push(performance.now() - started);
    }

    times.sort((left, right) => left - right);

    // The target is 50 ms on a developer machine; the number is printed so a slow run can be read, not guessed.
    console.log(`event hook median ${times[10].toFixed(1)} ms, p95 ${times[18].toFixed(1)} ms`);
    expect(times[10]).toBeLessThan(500);
  });
});

describe('EventHook.run: the notification type is kept, so a title does not hide where the line came from', () => {
  test('a needs-owner line from the hook carries its notification type; one written by hand carries none', () => {
    const root = createProject({
      files: { '.agents/vulcan.manifest.json': JSON.stringify({ events: { log: true } }) },
    });
    const written = EventHook.run({
      root,
      input: wire({
        hookEventName: 'Notification',
        notificationType: 'permission_prompt',
        title: 'Claude needs your permission to use Bash',
        sessionId: 's1',
      }),
      env: { VULCAN_ACTOR: 'pnt-vulcan-1' },
    });

    expect(written).toMatchObject({
      kind: 'needs-owner',
      summary: 'Claude needs your permission to use Bash',
      notification: 'permission_prompt',
      source: 'claude-hook',
    });
    expect(
      EventLog.build({ kind: 'needs-owner', summary: 'Which way?', actor: 'a', source: 'cli' }),
    ).not.toHaveProperty('notification');
  });

  test('the field is a short enum: a value that is not a prompt type is not written and is dropped on read', () => {
    const built = EventLog.build({
      kind: 'needs-owner',
      summary: 'x',
      actor: 'a',
      source: 'claude-hook',
      notification: 'rm -rf /',
    });

    expect(built).not.toHaveProperty('notification');
    expect(
      EventLog.parse({
        line: JSON.stringify({
          ...EventLog.build({ kind: 'needs-owner', summary: 'x', actor: 'a', source: 'cli' }),
          notification: 'rm -rf /',
        }),
      }),
    ).not.toHaveProperty('notification');
    expect(
      EventLog.parse({ line: JSON.stringify({ ...built, notification: 'idle_prompt' }) })
        ?.notification,
    ).toBe('idle_prompt');
    expect(EventLog.parse({ line: JSON.stringify({ ...built, notification: 7 }) })).toBeUndefined();
  });
});
