import { afterAll, describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { LocalChoice } from '../../agents/local.ts';
import { BoardAutoStart } from '../../board/auto-start.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { CapturedStderr } from '../stderr.helper.ts';

let stderr: CapturedStderr;

beforeEach(() => {
  stderr = CapturedStderr.start();
});

afterAll(removeProjects);

// A stand-in for the project's own `vulcan`: it records its arguments, the folder it ran in and the variables it got.
const FAKE =
  "await Bun.write('started.txt', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env) }));\n";
const project = (opts: { autoStart?: boolean; log?: boolean }): string =>
  createProject({
    files: {
      '.agents/local/vulcan.manifest.json': JSON.stringify({ events: { log: opts.log ?? true } }),
      '.agents/local/profile.json': JSON.stringify({
        schemaVersion: 1,
        ...(opts.autoStart === undefined
          ? {}
          : { board: { serve: { autoStart: opts.autoStart } } }),
      }),
      'node_modules/.bin/vulcan': FAKE,
    },
  });
const waitFor = async (file: string): Promise<boolean> => {
  for (let at = 0; at < 100; at += 1) {
    if (existsSync(file)) {
      return true;
    }

    await Bun.sleep(50);
  }

  return false;
};
const freePort = (): number => {
  const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const { port } = server;

  server.stop(true);

  return port;
};
const answering = (opts: { headers?: Record<string, string> }) =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('x', { status: 403, headers: opts.headers }),
  });

/** Registered last: it fails on an unclaimed line, and a failing hook skips the hooks after it. */
afterEach(() => {
  stderr.restore();
});

describe('board.serve.autoStart is a personal setting', () => {
  test('the local file accepts it as a boolean and refuses anything else under board.serve', () => {
    const ok = createProject({
      files: {
        '.agents/local/profile.json': JSON.stringify({
          schemaVersion: 1,
          board: { serve: { autoStart: true } },
        }),
      },
    });
    const bad = createProject({
      files: {
        '.agents/local/profile.json': JSON.stringify({
          schemaVersion: 1,
          board: { serve: { autoStart: 'yes' } },
        }),
      },
    });

    expect(LocalChoice.read({ root: ok }).ok).toBe(true);
    expect(LocalChoice.read({ root: bad }).ok).toBe(false);
  });

  test('it is on only with the local setting and the event log', () => {
    expect(BoardAutoStart.isOn({ root: project({ autoStart: true }) })).toBe(true);
    expect(BoardAutoStart.isOn({ root: project({}) })).toBe(false);
    expect(BoardAutoStart.isOn({ root: project({ autoStart: false }) })).toBe(false);
    expect(BoardAutoStart.isOn({ root: project({ autoStart: true, log: false }) })).toBe(false);
    expect(BoardAutoStart.isOn({ root: createProject({ files: {} }) })).toBe(false);
  });
});

describe('the board started by a session', () => {
  test('nothing listens: the project own vulcan starts detached with --port, a trimmed environment and a private log', async () => {
    const root = project({ autoStart: true });
    const port = freePort();
    const before = { ...process.env };

    process.env.VULCAN_ACTOR = 'someone-1';
    process.env.SOME_API_KEY = 'secret';

    try {
      const result = await BoardAutoStart.tick({ root, port });
      expect(result).toBe('started');
    } finally {
      process.env = before;
    }

    const result2 = await waitFor(join(root, 'started.txt'));
    expect(result2).toBe(true);

    const seen = JSON.parse(readFileSync(join(root, 'started.txt'), 'utf8'));

    expect(seen.args).toEqual(['board', 'serve', '--port', String(port)]);
    expect(seen.cwd).toBe(root);
    expect(seen.env).not.toContain('VULCAN_ACTOR');
    expect(seen.env).not.toContain('SOME_API_KEY');
    expect(seen.env).toContain('PATH');
    expect(statSync(join(root, '.agents/tmp/board-serve.log')).mode % 0o1000).toBe(0o600);
  });

  test('a VULCAN board already answers: nothing is started, twice never', async () => {
    const root = project({ autoStart: true });
    const server = answering({ headers: { 'x-vulcan-board': '1' } });

    const result = await BoardAutoStart.tick({ root, port: server.port });
    expect(result).toBe('running');
    await server.stop(true);
    await Bun.sleep(100);
    expect(existsSync(join(root, 'started.txt'))).toBe(false);
  });

  test('another program holds the port: nothing is started, and one line says so in the log', async () => {
    const root = project({ autoStart: true });
    const server = answering({});
    // Read before the stop: a stopped server has no port.
    const { port } = server;

    const result = await BoardAutoStart.tick({ root, port });
    expect(result).toBe('foreign');
    await server.stop(true);
    await Bun.sleep(100);
    expect(existsSync(join(root, 'started.txt'))).toBe(false);
    expect(readFileSync(join(root, '.agents/tmp/board-serve.log'), 'utf8')).toContain(
      'is held by something that is not a VULCAN board',
    );

    stderr.claim({
      parts: [
        `vulcan: [session-start] port ${port} is held by something that is not a VULCAN board, so no board was started`,
      ],
    });
  });

  test('a listener that never answers is not a board: the probe gives up after its short timeout', async () => {
    const root = project({ autoStart: true });
    const silent = createServer(() => undefined);

    await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));

    const address = silent.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const began = Date.now();

    const result = await BoardAutoStart.portState({ port });
    expect(result).toBe('other');
    expect(Date.now() - began).toBeLessThan(3000);
    silent.close();
    expect(existsSync(join(root, 'started.txt'))).toBe(false);
  });

  test('off: nothing is probed or started', async () => {
    const root = project({});

    const result = await BoardAutoStart.tick({ root, port: 1 });
    expect(result).toBe('off');
    expect(existsSync(join(root, '.agents/tmp'))).toBe(false);
  });

  test('the real command with a busy explicit port exits non-zero and says it cannot serve (the race loser leaves no orphan)', async () => {
    const root = project({ autoStart: true });
    const busy = answering({});
    const result = runCli({
      args: ['board', 'serve', '--port', String(busy.port), '--no-github'],
      cwd: root,
    });

    await busy.stop(true);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('cannot serve');
  });
});
