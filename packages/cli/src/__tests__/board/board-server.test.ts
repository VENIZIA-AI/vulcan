import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BoardCommand } from '../../board/command.ts';
import { BoardServe } from '../../board/common/index.ts';
import { BoardServer } from '../../board/server.ts';
import { EventLog } from '../../events/log.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { line, sampleLines } from './log-lines.helper.ts';

afterAll(removeProjects);
afterEach(() => BoardServer.stop());

const TOKEN = 'a'.repeat(32);
const PORT = 4317;

const check = (opts: {
  method?: string;
  path?: string;
  host?: string | null;
  origin?: string | null;
  token?: string | null;
}) =>
  BoardServer.check({
    method: opts.method ?? 'GET',
    url: `http://127.0.0.1:${PORT}${opts.path ?? '/'}${opts.token === null ? '' : `?t=${opts.token ?? TOKEN}`}`,
    host: opts.host === undefined ? `127.0.0.1:${PORT}` : opts.host,
    origin: opts.origin ?? null,
    port: PORT,
    token: TOKEN,
  });

describe('BoardServer.check: who may read the board', () => {
  test('the page and the stream, with the token and a local Host', () => {
    expect(check({})).toEqual({ status: 200, route: 'page' });
    expect(check({ path: '/stream' })).toEqual({ status: 200, route: 'stream' });
    expect(check({ host: `localhost:${PORT}` })).toEqual({ status: 200, route: 'page' });
  });

  test.each([
    ['no token', { token: null }],
    ['a wrong token', { token: 'b'.repeat(32) }],
    ['a token of another length', { token: 'a' }],
    ['an empty token', { token: '' }],
    ['a multibyte token of the right length in characters', { token: 'é'.repeat(32) }],
    ['a token with a lone surrogate', { token: '\ud800'.repeat(32) }],
    ['no Host', { host: null }],
    ['a foreign Host (DNS rebinding)', { host: `evil.example:${PORT}` }],
    ['another port in Host', { host: '127.0.0.1:1' }],
    ['a foreign Origin', { origin: 'http://evil.example' }],
    ['a null Origin', { origin: 'null' }],
    ['another port in Origin', { origin: 'http://127.0.0.1:1' }],
  ])('%s is 403', (_name, opts) => {
    expect(check(opts)).toEqual({ status: 403 });
  });

  test('host names are not case sensitive', () => {
    expect(check({ host: `LocalHost:${PORT}` }).status).toBe(200);
    expect(check({ origin: `HTTP://LOCALHOST:${PORT}` }).status).toBe(200);
    expect(check({ host: `EVIL.example:${PORT}` }).status).toBe(403);
  });

  test('the same origin and no Origin at all are fine', () => {
    expect(check({ origin: `http://127.0.0.1:${PORT}` }).status).toBe(200);
    expect(check({ origin: `http://localhost:${PORT}` }).status).toBe(200);
  });

  test('only GET: anything else is 405, after the checks that never leak a route', () => {
    expect(check({ method: 'POST' })).toEqual({ status: 405 });
    expect(check({ method: 'POST', token: null })).toEqual({ status: 403 });
  });

  test('an unknown route is 404, and only for a caller that passed the checks', () => {
    expect(check({ path: '/admin' })).toEqual({ status: 404 });
    expect(check({ path: '/admin', token: null })).toEqual({ status: 403 });
  });
});

const projectWithLog = (): { root: string; dir: string } => {
  const root = createProject({
    files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'ref: refs/heads/x\n' },
  });
  const dir = join(root, '.agents/local/events');

  for (const event of sampleLines()) {
    EventLog.append({ dir, event });
  }

  return { root, dir };
};

const SINCE = Date.parse('2026-11-01');

const startOn = (opts: { root: string; dir: string; port: number; maxSnapshotBytes?: number }) =>
  BoardServer.start({
    dir: opts.dir,
    collect: () =>
      BoardCommand.collect({
        root: opts.root,
        dir: opts.dir,
        since: SINCE,
        args: { repos: [], noGithub: true },
      }),
    port: opts.port,
    ...(opts.maxSnapshotBytes === undefined ? {} : { maxSnapshotBytes: opts.maxSnapshotBytes }),
  });

interface IStream {
  next: (opts: { ms: number }) => Promise<{ flows: { id: string }[] } | undefined>;
  status: number;
  close: () => void;
}

/** Reads the `data:` messages of the stream, one JSON snapshot per call. */
const openStream = async (opts: {
  url: string;
  headers?: Record<string, string>;
}): Promise<IStream> => {
  const controller = new AbortController();
  const response = await fetch(opts.url, { signal: controller.signal, headers: opts.headers });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const next: IStream['next'] = async ({ ms }) => {
    const deadline = Date.now() + ms;

    while (reader !== undefined && Date.now() < deadline) {
      const end = buffer.indexOf('\n\n');

      if (end >= 0) {
        const block = buffer.slice(0, end);

        buffer = buffer.slice(end + 2);

        const data = block.split('\n').find((row) => row.startsWith('data: '));

        if (data !== undefined) {
          return JSON.parse(data.slice('data: '.length));
        }

        continue;
      }

      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(() => undefined),
      ]);

      if (chunk === undefined || chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value);
    }

    return undefined;
  };

  return { next, status: response.status, close: () => controller.abort() };
};

describe('vulcan board serve', () => {
  test('serves the page on 127.0.0.1 with the token, and the headers a local page needs', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const response = await fetch(server.url);
    const html = await response.text();

    expect(server.url.startsWith('http://127.0.0.1:')).toBe(true);
    expect(response.status).toBe(200);
    expect(html).toContain('id="board-data"');
    expect(html).toContain(`"stream":"${BoardServe.STREAM_PATH}?${BoardServe.TOKEN_PARAM}=`);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('a request with no token, a wrong token or a foreign Origin is refused with no body', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const base = server.url.split('?')[0];
    const none = await fetch(base);
    const wrong = await fetch(`${base}?t=${'0'.repeat(32)}`);
    const foreign = await fetch(server.url, { headers: { origin: 'http://evil.example' } });
    const posted = await fetch(server.url, { method: 'POST' });

    expect([none.status, wrong.status, foreign.status, posted.status]).toEqual([
      403, 403, 403, 405,
    ]);
    const result = await none.text();
    expect(result).toBe('');
    const result2 = await foreign.text();
    expect(result2).toBe('');
  });

  test('the stream sends the board at once, then a new snapshot when the log changes', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const stream = await openStream({ url: server.url.replace('/?', '/stream?') });
    const first = await stream.next({ ms: 3000 });

    expect(stream.status).toBe(200);
    expect(first?.flows.map((flow) => flow.id)).not.toContain('F-9');

    EventLog.append({
      dir,
      event: line({
        minute: 200,
        kind: 'commit',
        actor: 'pnt-vulcan-1',
        flow: 'F-9',
        summary: 'a new flow',
        ref: 'ffff000',
      }),
    });

    const second = await stream.next({ ms: 5000 });

    expect(second?.flows.map((flow) => flow.id)).toContain('F-9');
    stream.close();
  });

  test('a log that does not exist yet is an empty board, and the first line of it arrives', async () => {
    const root = createProject({ files: { '.agents/vulcan.manifest.json': '{}' } });
    const dir = join(root, '.agents/local/events');
    const server = await startOn({ root, dir, port: 0 });
    const stream = await openStream({ url: server.url.replace('/?', '/stream?') });
    const first = await stream.next({ ms: 3000 });

    expect(first?.flows).toEqual([]);

    EventLog.append({
      dir,
      event: line({
        minute: 1,
        kind: 'commit',
        actor: 'a',
        flow: 'F-1',
        summary: 's',
        ref: 'abc1234',
      }),
    });

    const second = await stream.next({ ms: 5000 });

    expect(second?.flows.map((flow) => flow.id)).toEqual(['F-1']);
    stream.close();
  });

  test('a stream without the token is refused, and at most eight are open at once', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const url = server.url.replace('/?', '/stream?');
    const refused = await fetch(url.split('?')[0]);
    const open: IStream[] = [];

    for (let index = 0; index < BoardServe.MAX_STREAMS; index++) {
      const result = await openStream({ url });
      open.push(result);
    }

    const ninth = await fetch(url);

    expect(refused.status).toBe(403);
    expect(open.map((stream) => stream.status)).toEqual(Array(BoardServe.MAX_STREAMS).fill(200));
    expect(ninth.status).toBe(503);

    for (const stream of open) {
      stream.close();
    }
  });

  test('a snapshot over the cap is not sent, and the stream says so', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0, maxSnapshotBytes: 10 });
    const stream = await openStream({ url: server.url.replace('/?', '/stream?') });
    const first = await stream.next({ ms: 3000 });

    expect(first).toMatchObject({ tooLarge: true });
    stream.close();
  });

  test('a multibyte token is a 403 with no body, never a server error with a stack', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const base = server.url.split('?')[0];
    const page = await fetch(`${base}?t=${encodeURIComponent('é'.repeat(32))}`);
    const stream = await fetch(`${base}stream?t=${encodeURIComponent('é'.repeat(32))}`);

    expect([page.status, stream.status]).toEqual([403, 403]);
    const result = await page.text();
    expect(result).toBe('');
    const result2 = await stream.text();
    expect(result2).toBe('');
  });

  test('an uppercase Host is answered like a lowercase one', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const port = new URL(server.url).port;
    const response = await fetch(server.url, { headers: { host: `LocalHost:${port}` } });

    expect(response.status).toBe(200);
  });

  test('a log that cannot be read: the page is 503 with no body, the stream keeps the last snapshot, and one line says why', async () => {
    const { root, dir } = projectWithLog();
    let broken = false;
    const server = await BoardServer.start({
      port: 0,
      dir,
      collect: () => {
        if (broken) {
          throw new Error('EACCES: permission denied');
        }

        return BoardCommand.collect({
          root,
          dir,
          since: SINCE,
          args: { repos: [], noGithub: true },
        });
      },
    });
    const stream = await openStream({ url: server.url.replace('/?', '/stream?') });
    const first = await stream.next({ ms: 3000 });
    const written: string[] = [];
    const write = process.stderr.write.bind(process.stderr);

    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));

      return true;
    };
    broken = true;

    try {
      const page = await fetch(server.url);

      EventLog.append({
        dir,
        event: line({
          minute: 400,
          kind: 'commit',
          actor: 'a',
          flow: 'F-8',
          summary: 's',
          ref: 'abc1234',
        }),
      });

      const second = await stream.next({ ms: 1500 });

      expect(page.status).toBe(503);
      const result = await page.text();
      expect(result).toBe('');
      expect(second, 'a failed read must not send a snapshot').toBeUndefined();
    } finally {
      process.stderr.write = write;
    }

    expect(first?.flows.length).toBeGreaterThan(0);
    expect(written.join('')).toContain('board: cannot read the board: EACCES');

    broken = false;

    const again = await fetch(server.url);

    expect(again.status).toBe(200);
    stream.close();
  });

  test('a snapshot is capped by bytes, not by characters', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });
    const stream = await openStream({ url: server.url.replace('/?', '/stream?') });
    const small = await stream.next({ ms: 3000 });

    stream.close();
    await BoardServer.stop();

    const bytes = Buffer.byteLength(JSON.stringify(small));
    const characters = JSON.stringify(small).length;
    const capped = await startOn({ root, dir, port: 0, maxSnapshotBytes: bytes - 1 });
    const again = await openStream({ url: capped.url.replace('/?', '/stream?') });

    expect(characters).toBeLessThanOrEqual(bytes);
    const result = await again.next({ ms: 3000 });
    expect(result).toMatchObject({ tooLarge: true });
    again.close();
  });

  test('a busy port falls back to a free one and says so', async () => {
    const { root, dir } = projectWithLog();
    const busy = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('x') });
    const busyPort = busy.port;

    if (busyPort === undefined) {
      throw new Error('the busy server has no port');
    }

    const server = await startOn({ root, dir, port: busyPort });

    expect(new URL(server.url).port).not.toBe(String(busyPort));
    expect(server.note).toContain(`port ${busyPort} is busy`);
    const result = await fetch(server.url);
    expect(result.status).toBe(200);

    await busy.stop(true);
  });

  test('stop closes the port', async () => {
    const { root, dir } = projectWithLog();
    const server = await startOn({ root, dir, port: 0 });

    await BoardServer.stop();

    const reached = await fetch(server.url).then(
      () => true,
      () => false,
    );

    expect(reached).toBe(false);
  });

  test('the token is never written to the project: no file holds it, and the event log is untouched', async () => {
    const { root, dir } = projectWithLog();
    const before = readdirSync(dir).map((name) => statSync(join(dir, name)).size);
    const server = await startOn({ root, dir, port: 0 });
    const token = new URL(server.url).searchParams.get(BoardServe.TOKEN_PARAM) ?? '';

    const result = await fetch(server.url);
    await result.text();

    const stream = await openStream({ url: server.url.replace('/?', '/stream?') });

    await stream.next({ ms: 3000 });
    stream.close();

    const holders: string[] = [];
    const scan = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);

        if (entry.isDirectory()) {
          scan(path);
        } else if (readFileSync(path, 'utf8').includes(token)) {
          holders.push(path);
        }
      }
    };

    scan(root);

    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(holders).toEqual([]);
    expect(readdirSync(dir).map((name) => statSync(join(dir, name)).size)).toEqual(before);
  });

  test('two runs have two tokens', async () => {
    const { root, dir } = projectWithLog();
    const first = await startOn({ root, dir, port: 0 });
    const tokenOne = new URL(first.url).searchParams.get(BoardServe.TOKEN_PARAM);

    await BoardServer.stop();

    const second = await startOn({ root, dir, port: 0 });

    expect(new URL(second.url).searchParams.get(BoardServe.TOKEN_PARAM)).not.toBe(tokenOne);
  });
});
