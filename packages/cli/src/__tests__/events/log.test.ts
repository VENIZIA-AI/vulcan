import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import {
  EventActor,
  EventActorNames,
  EventFlow,
  EventKinds,
  EventLog,
  EventSettings,
  EventText,
} from '../../events/index.ts';
import { git } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const NOW = Date.parse('2026-11-03T09:30:00.000Z');

describe('EventKinds', () => {
  test('the twelve kinds a board reads, and isValid', () => {
    expect([...EventKinds.SCHEME_SET]).toEqual([
      'session-start',
      'session-stop',
      'msg-sent',
      'msg-received',
      'needs-owner',
      'subagent-stop',
      'commit',
      'pr',
      'decision',
      'flow',
      'deploy',
      'tool-tick',
    ]);
    expect(EventKinds.isValid('commit')).toBe(true);
    expect(EventKinds.isValid('rollout')).toBe(false);
  });
});

describe('EventText', () => {
  test('a summary is one line, trimmed and cut', () => {
    expect(EventText.oneLine({ text: '  a\n\tb \r\n c  ', max: 50 })).toBe('a b c');
    expect(EventText.oneLine({ text: 'abcdefghij', max: 4 })).toBe('abcd');
    expect(EventText.oneLine({ text: 'x\u0000y\u001bz', max: 50 })).toBe('x y z');
  });

  test('a secret-shaped token is redacted before the text is cut', () => {
    const cases: [string, string][] = [
      [
        'pushed with ghp_abcdefghijklmnopqrstuvwxyz0123456789 today',
        'pushed with [redacted] today',
      ],
      ['publish npm_abcdefghijklmnopqrstu', 'publish [redacted]'],
      ['key sk-ant-abcdefghijklmnopqrstuvwx', 'key [redacted]'],
      ['aws AKIAABCDEFGHIJKLMNOP here', 'aws [redacted] here'],
      ['header Authorization: Bearer abc.def-ghi_jklmnop', 'header Authorization: [redacted]'],
      [
        'NPM_TOKEN=abc123 and PASSWORD: hunter2 done',
        'NPM_TOKEN=[redacted] and PASSWORD=[redacted] done',
      ],
      ['clone https://user:pa55word@github.com/x/y', 'clone https://[redacted]@github.com/x/y'],
      [`blob ${'a1B2'.repeat(12)} end`, 'blob [redacted] end'],
      [`sha256 ${'ab'.repeat(32)}`, 'sha256 [redacted]'],
    ];

    for (const [text, expected] of cases) {
      expect(EventText.oneLine({ text, max: 200 }), text).toBe(expected);
    }

    // The secret sits across the cut: it is gone before the cut, not half of it left.
    expect(EventText.oneLine({ text: 'x ghp_abcdefghijklmnopqrstuvwxyz0123456789', max: 12 })).toBe(
      'x [redacted]',
    );
  });

  test('the shapes of a credential a person pastes: quoted names, Google, GitLab, Stripe, Basic, JWT, spoken', () => {
    const cases: [string, string][] = [
      ['config {"token": "abc123"} saved', 'config {token=[redacted]} saved'],
      ["{'api_key':'abc123'}", '{api_key=[redacted]}'],
      [`key AIza${'A1b2C3d4E5'.repeat(3)}12345 here`, 'key [redacted] here'],
      ['pat glpat-abcdefghijklmnopqrst1 x', 'pat [redacted] x'],
      ['live sk_live_abcdefgh12345678 x', 'live [redacted] x'],
      ['test sk_test_abcdefgh12345678 x', 'test [redacted] x'],
      ['restricted rk_live_abcdefgh12345678', 'restricted [redacted]'],
      ['Authorization: Basic dXNlcjpwYXNzd29yZA== sent', 'Authorization: [redacted] sent'],
      ['Basic dXNlcjpwYXNzMTIz sent', '[redacted] sent'],
      [
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk ok',
        'jwt [redacted] ok',
      ],
      ['the password is hunter2 ok', 'the password is [redacted] ok'],
      ['Passwords were "p a s s" ok', 'Passwords is [redacted] ok'],
      ['API key is abc', 'API key is [redacted]'],
    ];

    for (const [text, expected] of cases) {
      expect(EventText.oneLine({ text, max: 300 }), text).toBe(expected);
    }
  });

  test('ordinary words that look near those shapes are left alone', () => {
    for (const text of [
      'Basic installation guide',
      'Basic usage of the tokenizer',
      'the token bucket is full',
      'keyboard shortcuts',
      'password reset page',
      'sk_live is the prefix',
      'eyJ is how a JWT starts',
    ]) {
      expect(EventText.oneLine({ text, max: 200 }), text).toBe(text);
    }
  });

  test('a control character of either range is a space, an escape sequence included', () => {
    expect(EventText.oneLine({ text: 'a\u001b[31mred\u009b2Jb', max: 50 })).toBe('a [31mred 2Jb');
    expect(EventText.stripControl({ text: 'x\u0007y\u007fz\u0085w' })).toBe('x y z w');
  });

  test('plain words, a commit hash, a branch and a path are left alone', () => {
    for (const text of [
      'merged feature/F-12-events-log into develop',
      'commit 6764140c8f1d2e3a4b5c6d7e8f9a0b1c2d3e4f50 landed',
      'turn ended',
      'reviewing packages/cli/src/events/log.ts',
    ]) {
      expect(EventText.oneLine({ text, max: 200 })).toBe(text);
    }
  });
});

describe('EventFlow', () => {
  test('Flow: F-n in the first line of a message', () => {
    expect(EventFlow.fromText({ text: 'Flow: F-12 board sync\nthe body F-99' })).toBe('F-12');
    expect(EventFlow.fromText({ text: '\n\nfyi. Flow:   F-3' })).toBe('F-3');
    expect(EventFlow.fromText({ text: 'no flow here\nFlow: F-5' })).toBeUndefined();
    expect(EventFlow.fromText({ text: 'Flow: F-x' })).toBeUndefined();
    expect(EventFlow.fromText({ text: 'Workflow: F-7' })).toBeUndefined();
  });

  test('F-n as a whole segment of a branch name', () => {
    expect(EventFlow.fromBranchName({ branch: 'feature/F-12-events-log' })).toBe('F-12');
    expect(EventFlow.fromBranchName({ branch: 'F-4-x' })).toBe('F-4');
    expect(EventFlow.fromBranchName({ branch: 'fix/F-4' })).toBe('F-4');
    expect(EventFlow.fromBranchName({ branch: 'feature/WF-12-x' })).toBeUndefined();
    expect(EventFlow.fromBranchName({ branch: 'feature/F-12x' })).toBeUndefined();
    expect(EventFlow.fromBranchName({ branch: 'develop' })).toBeUndefined();
  });

  test('--flow must look like F-n', () => {
    expect(EventFlow.isValid({ flow: 'F-1' })).toBe(true);
    expect(EventFlow.isValid({ flow: 'f-1' })).toBe(false);
    expect(EventFlow.isValid({ flow: 'F-1 x' })).toBe(false);
  });

  test('the branch is read from HEAD without git, in a folder, a subfolder and a linked worktree', () => {
    const root = createProject({ files: { 'a/b/c.txt': 'x' } });

    git({ cwd: root, args: ['init', '--quiet', '-b', 'feature/F-21-thing'] });
    git({ cwd: root, args: ['config', 'user.name', 'T'] });
    git({ cwd: root, args: ['config', 'user.email', 't@example.dev'] });
    git({ cwd: root, args: ['add', '-A'] });
    git({ cwd: root, args: ['commit', '--quiet', '-m', 'x'] });

    expect(EventFlow.fromBranch({ cwd: root })).toBe('F-21');
    expect(EventFlow.fromBranch({ cwd: join(root, 'a/b') })).toBe('F-21');

    const worktree = join(root, 'wt');

    git({ cwd: root, args: ['worktree', 'add', '-q', '-b', 'fix/F-22-other', worktree] });

    expect(EventFlow.fromBranch({ cwd: worktree })).toBe('F-22');

    git({ cwd: worktree, args: ['checkout', '-q', '--detach'] });

    expect(EventFlow.fromBranch({ cwd: worktree })).toBeUndefined();
  });

  test('outside a repository there is no flow, and no crash', () => {
    expect(EventFlow.fromBranch({ cwd: createProject({ files: {} }) })).toBeUndefined();
  });
});

describe('EventLog', () => {
  test('a built event has the documented fields in order, a clean summary and no empty field', () => {
    const event = EventLog.build({
      kind: 'commit',
      summary: ' fixed  the\nlock ',
      actor: 'pnt-vulcan-1',
      source: 'cli',
      flowId: 'F-2',
      ref: 'abc1234',
      now: NOW,
    });

    expect(Object.keys(event)).toEqual([
      'id',
      'ts',
      'flowId',
      'actor',
      'kind',
      'summary',
      'ref',
      'source',
    ]);
    expect(event.ts).toBe('2026-11-03T09:30:00.000Z');
    expect(event.summary).toBe('fixed the lock');

    const bare = EventLog.build({
      kind: 'pr',
      summary: 's',
      actor: 'a',
      source: 'cli',
      ref: '  ',
      now: NOW,
    });

    expect(Object.keys(bare)).toEqual(['id', 'ts', 'actor', 'kind', 'summary', 'source']);
  });

  test('a flow line keeps context (600 characters) and next (200) as one clean line each, after why and before source', () => {
    const event = EventLog.build({
      kind: 'flow',
      summary: 'Title',
      actor: 'a',
      source: 'cli',
      flowId: 'F-1',
      why: 'because',
      context: `${'x'.repeat(700)}`,
      next: `a\nb ${'n'.repeat(300)}`,
      now: NOW,
    });

    expect(Object.keys(event)).toEqual([
      'id',
      'ts',
      'flowId',
      'actor',
      'kind',
      'summary',
      'why',
      'context',
      'next',
      'source',
    ]);
    expect(event.context).toHaveLength(600);
    expect(Array.from(event.next ?? '')).toHaveLength(200);
    expect(event.next).not.toContain('\n');
    expect(EventLog.parse({ line: JSON.stringify(event) })).toEqual(event);
    expect(
      EventLog.build({
        kind: 'flow',
        summary: 'T',
        actor: 'a',
        source: 'cli',
        context: '  ',
        now: NOW,
      }),
    ).not.toHaveProperty('context');
    expect(EventLog.parse({ line: JSON.stringify({ ...event, context: 7 }) })).toBeUndefined();
  });

  test('parse cleans the free text of a line as build does: one line, secrets redacted, the same caps', () => {
    const token = 'ghp_abcdefghijklmnop1234567890';
    const line = JSON.stringify({
      id: 'i1',
      ts: '2026-11-03T09:30:00.000Z',
      actor: 'a',
      kind: 'flow',
      summary: `${token} ${'s '.repeat(1_000_000)}`,
      why: `line one\n${token} ${'w'.repeat(5000)}`,
      context: `${token} ${'c '.repeat(2000)}`,
      next: `${'n '.repeat(2000)} ${token}`,
      source: 'cli',
    });
    const event = EventLog.parse({ line });

    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain(token);
    expect(Array.from(event?.summary ?? '').length).toBeLessThanOrEqual(200);
    expect(Array.from(event?.why ?? '').length).toBeLessThanOrEqual(200);
    expect(Array.from(event?.context ?? '').length).toBeLessThanOrEqual(600);
    expect(Array.from(event?.next ?? '').length).toBeLessThanOrEqual(200);
    expect(event?.why).not.toContain('\n');
    expect(event?.summary).toStartWith('[redacted]');
    expect(event?.context).toStartWith('[redacted]');
  });

  test('parse and build clean a ref too: a token is redacted and a long value is cut', () => {
    const token = 'ghp_abcdefghijklmnop1234567890';
    const long = `from:${token} ${'r'.repeat(5000)}`;
    const built = EventLog.build({
      kind: 'msg-received',
      summary: 's',
      actor: 'a',
      source: 'cli',
      ref: long,
      now: NOW,
    });
    const read = EventLog.parse({
      line: JSON.stringify({
        id: 'i1',
        ts: '2026-11-03T09:30:00.000Z',
        actor: 'a',
        kind: 'msg-received',
        summary: 's',
        ref: long,
        source: 'cli',
      }),
    });

    for (const ref of [built.ref ?? '', read?.ref ?? '']) {
      expect(ref).not.toContain(token);
      expect(ref).toStartWith('from:[redacted]');
      expect(Array.from(ref).length).toBeLessThanOrEqual(120);
    }
  });

  test('parse strips control characters from every text field, so tail never prints an escape sequence', () => {
    const line = JSON.stringify({
      id: 'i\u001bd',
      ts: '2026-11-03T09:30:00.000Z',
      flowId: 'F-1\u001b',
      actor: 'a\u001b[2Jb',
      kind: 'commit',
      summary: 'x\u009by',
      ref: 'r\u0007',
      source: 'cli\u001b',
    });
    const event = EventLog.parse({ line });

    expect(JSON.stringify(event)).not.toMatch(/\\u00(1b|9b|07)/);
    expect(event).toMatchObject({ actor: 'a [2Jb', summary: 'x y', ref: 'r', source: 'cli ' });
  });

  test('ids sort by time and do not collide', () => {
    const first = EventLog.newId({ now: NOW });
    const later = EventLog.newId({ now: NOW + 1 });
    // 32 random bits within one millisecond: 200 ids repeat once in 200 000 runs, 2000 once in 2 000 (birthday bound).
    const ids = new Set(Array.from({ length: 200 }, () => EventLog.newId({ now: NOW })));

    expect(first < later).toBe(true);
    expect(ids.size).toBe(200);
    expect(first).toMatch(/^[0-9a-z]{9}[0-9a-f]{8}$/);
  });

  test('append writes one line to the file of the local day, creating the folder', () => {
    const dir = join(createProject({ files: {} }), 'deep', 'events');
    const event = EventLog.build({
      kind: 'pr',
      summary: 'opened',
      actor: 'a',
      source: 'cli',
      now: NOW,
    });
    const file = EventLog.append({ dir, event });

    expect(file).toBe(join(dir, `${EventLog.dayOf({ time: NOW })}.jsonl`));
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify(event)}\n`);
    expect(readdirSync(dir)).toEqual([`${EventLog.dayOf({ time: NOW })}.jsonl`]);
  });

  test('read returns the events oldest first, filtered by since, and counts what is not an event', () => {
    const dir = createProject({ files: {} });
    const at = (offset: number, kind: 'commit' | 'pr') =>
      EventLog.build({
        kind,
        summary: `at ${offset}`,
        actor: 'a',
        source: 'cli',
        now: NOW + offset,
      });

    for (const event of [at(2000, 'pr'), at(0, 'commit'), at(1000, 'commit')]) {
      EventLog.append({ dir, event });
    }

    // A day file two days back, a line that is not JSON, a JSON line of another shape, a line of an unknown kind.
    const old = EventLog.build({
      kind: 'commit',
      summary: 'old',
      actor: 'a',
      source: 'cli',
      now: NOW - 2 * 86_400_000,
    });

    EventLog.append({ dir, event: old });
    writeFileSync(
      join(dir, `${EventLog.dayOf({ time: NOW })}.jsonl`),
      `${readFileSync(join(dir, `${EventLog.dayOf({ time: NOW })}.jsonl`), 'utf8')}not json\n{"a":1}\n${JSON.stringify({ ...at(0, 'pr'), kind: 'rollout' })}\n\n`,
    );

    const all = EventLog.read({ dir });

    expect(all.events.map((event) => event.summary)).toEqual(['old', 'at 0', 'at 1000', 'at 2000']);
    expect(all.skipped).toBe(3);

    const since = EventLog.read({ dir, since: NOW + 500 });

    expect(since.events.map((event) => event.summary)).toEqual(['at 1000', 'at 2000']);
  });

  test('a folder that is not there holds no events', () => {
    expect(EventLog.read({ dir: join(createProject({ files: {} }), 'none') })).toEqual({
      events: [],
      skipped: 0,
    });
  });

  test('sessions appending at the same moment do not interleave or lose a line', () => {
    const dir = createProject({ files: {} });
    const script = join(import.meta.dir, 'append-many.helper.ts');
    const children = Array.from({ length: 6 }, (_, index) =>
      Bun.spawn([process.execPath, script, dir, String(index), '150'], {
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    );

    return Promise.all(children.map((child) => child.exited)).then(() => {
      const { events, skipped } = EventLog.read({ dir });

      expect(skipped).toBe(0);
      expect(events.length).toBe(6 * 150);
      expect(new Set(events.map((event) => event.id)).size).toBe(6 * 150);
    });
  });
});

describe('EventSettings', () => {
  const projectWith = (opts: { events?: unknown; raw?: string }): string =>
    createProject({
      files: {
        '.agents/vulcan.manifest.json':
          opts.raw ?? JSON.stringify(opts.events === undefined ? {} : { events: opts.events }),
      },
    });

  test('off and in the project when the manifest is silent, missing or broken', () => {
    expect(EventSettings.read({ root: createProject({ files: {} }) })).toEqual({ log: false });
    expect(EventSettings.read({ root: projectWith({}) })).toEqual({ log: false });
    expect(EventSettings.read({ root: projectWith({ raw: '{ nope' }) })).toEqual({ log: false });
    expect(EventSettings.read({ root: projectWith({ events: 'yes' }) })).toEqual({ log: false });
    expect(EventSettings.read({ root: projectWith({ events: { log: 'true' } }) })).toEqual({
      log: false,
    });
  });

  test('log and dir are read; a dir that is not absolute is ignored', () => {
    expect(EventSettings.read({ root: projectWith({ events: { log: true } }) })).toEqual({
      log: true,
    });
    expect(
      EventSettings.read({ root: projectWith({ events: { log: false, dir: '/shared/events' } }) }),
    ).toEqual({
      log: false,
      dir: '/shared/events',
    });
    expect(
      EventSettings.read({ root: projectWith({ events: { log: true, dir: 'rel/events' } }) }),
    ).toEqual({
      log: true,
    });
  });

  test('dirOf: the asked folder, else the manifest dir, else the project default', () => {
    const root = projectWith({ events: { log: true, dir: '/shared/events' } });

    expect(EventSettings.dirOf({ root, dir: '/other' })).toBe('/other');
    expect(EventSettings.dirOf({ root })).toBe('/shared/events');
    const plain = projectWith({ events: { log: true } });

    expect(EventSettings.dirOf({ root: plain })).toBe(join(plain, '.agents/local/events'));
    expect(EventSettings.dirOf({ root: '/p', dir: 'rel' })).toBe('/p/rel');
  });

  test('rootOf: the nearest folder above with the manifest or .git, itself included', () => {
    const withManifest = createProject({
      files: { '.agents/vulcan.manifest.json': '{}', 'a/b/c/x.txt': 'x' },
    });
    const gitOnly = createProject({
      files: { '.git/HEAD': 'ref: refs/heads/x\n', 'a/b/x.txt': 'x' },
    });
    const nested = createProject({
      files: {
        '.agents/vulcan.manifest.json': '{}',
        'inner/.git/HEAD': 'x',
        'inner/deep/x.txt': 'x',
      },
    });
    const both = createProject({
      files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'x', 'w/x.txt': 'x' },
    });

    expect(EventSettings.rootOf({ cwd: join(withManifest, 'a/b/c') })).toBe(withManifest);
    expect(EventSettings.rootOf({ cwd: withManifest })).toBe(withManifest);
    expect(EventSettings.rootOf({ cwd: join(gitOnly, 'a/b') })).toBe(gitOnly);
    expect(EventSettings.rootOf({ cwd: join(both, 'w') })).toBe(both);
    // A repository inside a project is a project of its own.
    expect(EventSettings.rootOf({ cwd: join(nested, 'inner/deep') })).toBe(join(nested, 'inner'));
  });

  test('dirError names why a folder is refused', () => {
    expect(EventSettings.dirError({ dir: '/abs/ok' })).toBeUndefined();
    expect(EventSettings.dirError({ dir: '~/events' })).toContain('absolute');
    expect(EventSettings.dirError({ dir: 'events' })).toContain('absolute');
    expect(EventSettings.dirError({ dir: '/a\0b' })).toContain('NUL');
  });
});

describe('EventActor', () => {
  const sessions = (opts: { files: Record<string, string> }): string => {
    const config = createProject({ files: {} });

    mkdirSync(join(config, 'sessions'));

    for (const [name, text] of Object.entries(opts.files)) {
      writeFileSync(join(config, 'sessions', name), text);
    }

    return config;
  };

  test('VULCAN_ACTOR wins', () => {
    expect(EventActor.resolve({ sessionId: 'abc', env: { VULCAN_ACTOR: 'pnt-x-1' } })).toBe(
      'pnt-x-1',
    );
  });

  test('the name Claude Code gave the session, found by session id, past a broken file', () => {
    const config = sessions({
      files: {
        '1.json': '{ not json',
        '2.json': JSON.stringify({ sessionId: 'other', name: 'someone-else' }),
        '3.json': JSON.stringify({
          sessionId: 'abcdef12-0000',
          name: 'pnt-vulcan-1',
          status: 'idle',
        }),
      },
    });

    expect(
      EventActor.resolve({ sessionId: 'abcdef12-0000', env: { CLAUDE_CONFIG_DIR: config } }),
    ).toBe('pnt-vulcan-1');
  });

  test('several files for one session: a live process wins, then the newest', () => {
    const DEAD = 2_147_483_000;
    const file = (opts: { name: string; pid: number; updatedAt: number }) =>
      JSON.stringify({ sessionId: 's1', ...opts });
    const resolve = (files: Record<string, string>) =>
      EventActor.resolve({ sessionId: 's1', env: { CLAUDE_CONFIG_DIR: sessions({ files }) } });

    expect(
      resolve({
        '1.json': file({ name: 'old-live', pid: process.pid, updatedAt: 1 }),
        '2.json': file({ name: 'new-dead', pid: DEAD, updatedAt: 99 }),
      }),
    ).toBe('old-live');
    expect(
      resolve({
        '1.json': file({ name: 'older', pid: DEAD, updatedAt: 5 }),
        '2.json': file({ name: 'newer', pid: DEAD + 1, updatedAt: 9 }),
        '3.json': file({ name: 'oldest', pid: DEAD + 2, updatedAt: 1 }),
      }),
    ).toBe('newer');
    expect(
      resolve({
        '1.json': file({ name: 'a-live', pid: process.pid, updatedAt: 5 }),
        '2.json': file({ name: 'b-live', pid: process.pid, updatedAt: 9 }),
      }),
    ).toBe('b-live');
  });

  test('without a name: claude: and the start of the session id; without a session: unknown', () => {
    const config = sessions({ files: {} });

    expect(
      EventActor.resolve({ sessionId: 'abcdef12-0000', env: { CLAUDE_CONFIG_DIR: config } }),
    ).toBe('claude:abcdef12');
    expect(EventActor.resolve({ env: { CLAUDE_CONFIG_DIR: config } })).toBe('unknown');
    expect(
      EventActor.resolve({ sessionId: 'x', env: { CLAUDE_CONFIG_DIR: join(config, 'missing') } }),
    ).toBe('claude:x');
  });

  test('a name is the actor only when the session was named: derived, auto and collision names are not', () => {
    const resolve = (nameSource: string | undefined): string =>
      EventActor.resolve({
        sessionId: 'abcdef12-0000',
        env: {
          CLAUDE_CONFIG_DIR: sessions({
            files: {
              '1.json': JSON.stringify({
                sessionId: 'abcdef12-0000',
                name: 'my-folder-6d',
                ...(nameSource === undefined ? {} : { nameSource }),
              }),
            },
          }),
        },
      });

    for (const given of ['user', 'peer']) {
      expect(resolve(given)).toBe('my-folder-6d');
    }

    for (const made of ['derived', 'auto', 'collision']) {
      expect(resolve(made)).toBe('claude:abcdef12');
    }

    // No readable source: a person's name more often than not, and hiding a real agent is the worse mistake.
    expect(resolve(undefined)).toBe('my-folder-6d');
    expect(resolve('something-new')).toBe('my-folder-6d');
  });

  test('two registry files for one session, a derived name and a given one: the given name wins, even when the derived file is newer or lives', () => {
    const file = (opts: { name: string; nameSource: string; pid: number; updatedAt: number }) =>
      JSON.stringify({ sessionId: 's1', ...opts });
    const resolve = (files: Record<string, string>) =>
      EventActor.resolve({ sessionId: 's1', env: { CLAUDE_CONFIG_DIR: sessions({ files }) } });

    expect(
      resolve({
        '1.json': file({
          name: 'folder-6d',
          nameSource: 'derived',
          pid: process.pid,
          updatedAt: 99,
        }),
        '2.json': file({ name: 'pnt-x-1', nameSource: 'user', pid: 2_147_483_000, updatedAt: 1 }),
      }),
    ).toBe('pnt-x-1');
    expect(
      resolve({
        '1.json': file({
          name: 'folder-6d',
          nameSource: 'derived',
          pid: process.pid,
          updatedAt: 99,
        }),
      }),
    ).toBe('claude:s1');
  });

  test('isNamed: an actor of the fallback shapes (claude:<id>, unknown) is not a name', () => {
    expect(EventActorNames.isNamed({ actor: 'pnt-vulcan-1' })).toBe(true);
    expect(EventActorNames.isNamed({ actor: 'claude:abcdef12' })).toBe(false);
    expect(EventActorNames.isNamed({ actor: 'unknown' })).toBe(false);
    expect(EventActorNames.isNamed({ actor: 'claudette' })).toBe(true);
  });

  test('a name is one clean line', () => {
    const config = sessions({
      files: {
        '1.json': JSON.stringify({
          sessionId: 's',
          name: 'a\nb   ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        }),
      },
    });

    expect(EventActor.resolve({ sessionId: 's', env: { CLAUDE_CONFIG_DIR: config } })).toBe(
      'a b [redacted]',
    );
  });
});

test('git is available to the tests that need it', () => {
  expect(spawnSyncBounded({ cmd: ['git', '--version'], cwd: '.' }).exitCode).toBe(0);
});
