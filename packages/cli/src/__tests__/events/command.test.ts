import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

/** A project folder: the manifest marks it, so a command run in it does not walk up into the repository the test run lives in. */
const project = (opts: { files?: Record<string, string> } = {}): string =>
  createProject({ files: { '.agents/vulcan.manifest.json': '{}', ...opts.files } });

const cli = (opts: { root: string; args: string[]; env?: Record<string, string> }) =>
  runCli({
    args: ['event', ...opts.args],
    cwd: opts.root,
    env: { ...hermeticEnv(), VULCAN_ACTOR: 'pnt-vulcan-1', ...opts.env },
  });

const lines = (opts: { dir: string }) =>
  readdirSync(opts.dir).flatMap((name) =>
    readFileSync(join(opts.dir, name), 'utf8').trim().split('\n'),
  );

describe('vulcan event add', () => {
  test('writes one line to the project folder and prints its id', () => {
    const root = project({ files: { '.git/HEAD': 'ref: refs/heads/feature/F-7-x\n' } });
    const result = cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'fixed the lock', '--ref', 'abc1234'],
    });

    expect(result.code, result.stderr).toBe(0);

    const [line] = lines({ dir: join(root, '.agents/local/events') });
    const event = JSON.parse(line);

    expect(result.stdout.trim()).toBe(event.id);
    expect(event).toMatchObject({
      kind: 'commit',
      summary: 'fixed the lock',
      ref: 'abc1234',
      actor: 'pnt-vulcan-1',
      flowId: 'F-7',
      source: 'cli',
    });
  });

  test('run from a subfolder it uses the project of that folder: the same events.dir and the same default folder', () => {
    const shared = createProject({ files: {} });
    const configured = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ events: { log: true, dir: shared } }),
        'packages/api/src/x.ts': 'x',
      },
    });
    const plain = project({
      files: { '.git/HEAD': 'ref: refs/heads/x\n', 'packages/api/src/x.ts': 'x' },
    });

    expect(
      cli({
        root: join(configured, 'packages/api/src'),
        args: ['add', '--kind', 'pr', '--summary', 's'],
      }).code,
    ).toBe(0);
    expect(lines({ dir: shared })).toHaveLength(1);
    expect(existsSync(join(configured, 'packages/api/src/.agents'))).toBe(false);
    expect(cli({ root: join(configured, 'packages/api'), args: ['tail'] }).stdout).toContain(
      ' pr ',
    );

    expect(
      cli({ root: join(plain, 'packages/api'), args: ['add', '--kind', 'pr', '--summary', 's'] })
        .code,
    ).toBe(0);
    expect(lines({ dir: join(plain, '.agents/local/events') })).toHaveLength(1);
    expect(existsSync(join(plain, 'packages/api/.agents'))).toBe(false);
  });

  test('a relative --dir is relative to where the command runs', () => {
    const root = project({ files: { 'sub/x.txt': 'x' } });

    expect(
      cli({
        root: join(root, 'sub'),
        args: ['add', '--kind', 'pr', '--summary', 's', '--dir', 'here'],
      }).code,
    ).toBe(0);
    expect(existsSync(join(root, 'sub/here'))).toBe(true);
  });

  test('a decision carries its status; nothing else may', () => {
    const root = project();
    const ok = cli({
      root,
      args: [
        'add',
        '--kind',
        'decision',
        '--status',
        'approve',
        '--flow',
        'F-4',
        '--summary',
        'Phat approved the design',
      ],
    });

    expect(ok.code, ok.stderr).toBe(0);
    expect(JSON.parse(lines({ dir: join(root, '.agents/local/events') })[0])).toMatchObject({
      kind: 'decision',
      status: 'approve',
      flowId: 'F-4',
    });

    for (const status of ['park', 'reject']) {
      expect(
        cli({ root, args: ['add', '--kind', 'decision', '--status', status, '--summary', 's'] })
          .code,
      ).toBe(0);
    }

    for (const args of [
      ['add', '--kind', 'decision', '--summary', 's'],
      ['add', '--kind', 'decision', '--status', 'maybe', '--summary', 's'],
      ['add', '--kind', 'commit', '--status', 'approve', '--summary', 's'],
    ]) {
      const result = cli({ root, args });

      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr, args.join(' ')).toMatch(/status|decision/);
    }

    expect(lines({ dir: join(root, '.agents/local/events') })).toHaveLength(3);
  });

  test('works with the log switched off in the manifest', () => {
    const root = project();

    expect(cli({ root, args: ['add', '--kind', 'pr', '--summary', 'opened'] }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/events'))).toBe(true);
  });

  test('--flow and --actor win; the manifest dir and --dir move the log', () => {
    const shared = createProject({ files: {} });
    const other = createProject({ files: {} });
    const root = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ events: { log: true, dir: shared } }),
      },
    });

    expect(
      cli({
        root,
        args: ['add', '--kind', 'pr', '--summary', 's', '--flow', 'F-2', '--actor', 'someone'],
      }).code,
    ).toBe(0);
    expect(JSON.parse(lines({ dir: shared })[0])).toMatchObject({
      flowId: 'F-2',
      actor: 'someone',
    });
    expect(
      cli({ root, args: ['add', '--kind', 'pr', '--summary', 's', '--dir', other] }).code,
    ).toBe(0);
    expect(lines({ dir: other })).toHaveLength(1);
    expect(existsSync(join(root, '.agents/local/events'))).toBe(false);
  });

  test('a secret in the summary is redacted and the text is one line', () => {
    const root = project();

    cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'used npm_abcdefghijklmnopqrstu\nsecond'],
    });

    expect(JSON.parse(lines({ dir: join(root, '.agents/local/events') })[0]).summary).toBe(
      'used [redacted] second',
    );
  });

  test('bad input exits 2 and writes nothing', () => {
    const root = project();
    const bad: string[][] = [
      ['add'],
      ['add', '--kind', 'deploy', '--summary', 's'],
      ['add', '--kind', 'commit'],
      ['add', '--kind', 'commit', '--summary', '  '],
      ['add', '--kind', 'commit', '--summary', 's', '--flow', 'flow-1'],
      ['add', '--kind', 'commit', '--summary', 's', '--kind', 'pr'],
      ['add', '--kind', 'commit', '--summary', 's', '--nope', 'x'],
      ['add', '--kind', 'commit', '--summary'],
      ['frobnicate'],
      [],
    ];

    for (const args of bad) {
      const result = cli({ root, args });

      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr, args.join(' ')).toMatch(/event/);
    }

    expect(existsSync(join(root, '.agents/local/events'))).toBe(false);
  });

  test('a folder it cannot write is exit 1 with the reason', () => {
    const root = project();
    const result = cli({
      root,
      args: ['add', '--kind', 'pr', '--summary', 's', '--dir', '/proc/vulcan-no-such/events'],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cannot write the log in /proc/vulcan-no-such/events');
  });
});

describe('vulcan event tail', () => {
  const NOW = Date.now();
  const seed = (): string => {
    const root = project();
    const dir = join(root, '.agents/local/events');

    for (const [offset, kind, summary] of [
      [-3 * 86_400_000, 'commit', 'three days ago'],
      [-2000, 'pr', 'second'],
      [-5000, 'commit', 'first'],
    ] as const) {
      EventLog.append({
        dir,
        event: EventLog.build({
          kind,
          summary,
          actor: 'a-1',
          source: 'cli',
          flowId: 'F-1',
          now: NOW + offset,
        }),
      });
    }

    return root;
  };

  test('defaults to the last 24 hours, oldest first, one readable line each', () => {
    const result = cli({ root: seed(), args: ['tail'] });
    const out = result.stdout.trim().split('\n');

    expect(result.code, result.stderr).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^\S+Z commit {8}a-1 F-1 first$/);
    expect(out[1]).toMatch(/^\S+Z pr {12}a-1 F-1 second$/);
  });

  test('--since reaches back, --json prints the lines as written', () => {
    const result = cli({
      root: seed(),
      args: ['tail', '--since', new Date(NOW - 10 * 86_400_000).toISOString(), '--json'],
    });
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(events.map((event) => event.summary)).toEqual(['three days ago', 'first', 'second']);
    expect(Object.keys(events[0])).toEqual([
      'id',
      'ts',
      'flowId',
      'actor',
      'kind',
      'summary',
      'source',
    ]);
  });

  test('--dir reads any folder; one that is not there is exit 2, the default one that is not there is empty', () => {
    const shared = createProject({ files: {} });
    const root = project();

    EventLog.append({
      dir: shared,
      event: EventLog.build({ kind: 'pr', summary: 'elsewhere', actor: 'x', source: 'cli' }),
    });

    expect(cli({ root, args: ['tail', '--dir', shared] }).stdout).toContain('elsewhere');
    expect(cli({ root, args: ['tail', '--dir', join(shared, 'missing')] }).code).toBe(2);
    expect(cli({ root, args: ['tail'] })).toMatchObject({ code: 0, stdout: '' });
  });

  test('a time it cannot read is exit 2; lines that are not events are counted on stderr', () => {
    const root = seed();

    expect(cli({ root, args: ['tail', '--since', 'yesterdayish'] }).code).toBe(2);

    const dir = join(root, '.agents/local/events');
    const [file] = readdirSync(dir).sort().slice(-1);

    writeFileSync(join(dir, file), `${readFileSync(join(dir, file), 'utf8')}garbage\n`);

    const result = cli({ root, args: ['tail'] });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('skipped 1 line(s)');
  });

  test('control characters in a line written by someone else never reach the terminal, in either format', () => {
    const root = project();
    const dir = join(root, '.agents/local/events');
    const event = EventLog.build({ kind: 'commit', summary: 's', actor: 'a', source: 'cli' });

    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${EventLog.dayOf({ time: Date.now() })}.jsonl`),
      `${JSON.stringify({ ...event, actor: 'evil\u001b]0;pwned\u0007', summary: 'x\u009b2Jy' })}\n`,
    );

    for (const args of [['tail'], ['tail', '--json']]) {
      const out = cli({ root, args }).stdout;

      const controls = [...out].filter((character) => {
        const code = character.codePointAt(0) ?? 0;

        return character !== '\n' && (code <= 0x1f || (code >= 0x7f && code <= 0x9f));
      });

      expect(controls, args.join(' ')).toEqual([]);
      expect(out).toContain('evil');
    }
  });

  test('help lists the command; an unknown flag is exit 2', () => {
    const root = project();

    expect(runCli({ args: ['help'], cwd: root }).stdout).toContain('event add --kind');
    expect(cli({ root, args: ['tail', '--bogus'] }).code).toBe(2);
  });
});
