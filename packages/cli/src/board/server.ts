import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server } from 'bun';
import { BoardRoutes, BoardServe } from './common/index.ts';
import type { IThemeTokens } from '../theme/index.ts';
import type { IBoardData, TBoardRoute } from './common/index.ts';
import { BoardPage } from './page.ts';
import { BoardWatch } from './watch.ts';

interface IBoardServerOptions {
  port: number;
  /** The name of the address; default `BoardServe.DEFAULT_HOSTNAME`. The server still listens on 127.0.0.1 only. */
  hostname?: string;
  /** The events folder to watch; a read of the board happens when it changes. */
  dir: string;
  /** The folded board, as `vulcan board` makes it. */
  collect: () => IBoardData;
  /** The design tokens of the page; default the default preset. */
  tokens?: IThemeTokens;
  maxSnapshotBytes?: number;
  /** The clock for the life of an open code, in milliseconds; default `Date.now`. */
  now?: () => number;
}

interface IBoardServerRun {
  server: Server<undefined>;
  token: string;
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
  latest: string;
  max: number;
  stopWatch: () => void;
  timers: ReturnType<typeof setInterval>[];
  /** The address the page is served under, without a path. */
  origin: string;
  now: () => number;
  /** The one open code that works, if any: a new one replaces it. */
  open?: { code: string; expiresAt: number };
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
const STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const encoder = new TextEncoder();

/**
 * `vulcan board serve`: the board on 127.0.0.1, and a stream that sends the next snapshot when the event log changes.
 * It writes nothing of the project; every request must carry this run's token (or the one-time open code) and a local Host and Origin.
 */
export class BoardServer {
  private static run: IBoardServerRun | undefined;

  /** Whether a request may be answered, and which route it asks for. Pure: no socket, so every refusal is tested alone. */
  static check(opts: {
    method: string;
    url: string;
    host: string | null;
    origin: string | null;
    port: number;
    token: string;
    hostname: string;
  }): { status: number; route?: TBoardRoute; code?: string } {
    const names = [
      `127.0.0.1:${opts.port}`,
      `localhost:${opts.port}`,
      `${opts.hostname.toLowerCase()}:${opts.port}`,
    ];
    const host = opts.host?.toLowerCase() ?? null;
    const origin = opts.origin?.toLowerCase() ?? null;

    if (host === null || !names.includes(host)) {
      return { status: 403 };
    }

    if (origin !== null && !names.some((name) => origin === `http://${name}`)) {
      return { status: 403 };
    }

    const url = new URL(opts.url);

    const code = url.pathname.startsWith(BoardServe.OPEN_PATH)
      ? url.pathname.slice(BoardServe.OPEN_PATH.length)
      : '';

    if (code !== '' && !code.includes('/')) {
      return opts.method === 'GET'
        ? { status: 200, route: BoardRoutes.OPEN, code }
        : { status: 405 };
    }

    const given = url.searchParams.get(BoardServe.TOKEN_PARAM);

    if (given === null || !BoardServer.isToken({ given, token: opts.token })) {
      return { status: 403 };
    }

    if (opts.method !== 'GET') {
      return { status: 405 };
    }

    if (url.pathname === BoardServe.PAGE_PATH) {
      return { status: 200, route: BoardRoutes.PAGE };
    }

    return url.pathname === BoardServe.STREAM_PATH
      ? { status: 200, route: BoardRoutes.STREAM }
      : { status: 404 };
  }

  /** Starts the server on `port`, or on a free one when it is busy. */
  static async start(
    opts: IBoardServerOptions,
  ): Promise<{ url: string; fallback: string; note?: string }> {
    await BoardServer.stop();

    const token = randomBytes(BoardServe.TOKEN_BYTES).toString('hex');
    const max = opts.maxSnapshotBytes ?? BoardServe.MAX_SNAPSHOT_BYTES;
    const hostname = opts.hostname ?? BoardServe.DEFAULT_HOSTNAME;
    const listen = (port: number): Server<undefined> =>
      Bun.serve({
        hostname: BoardServe.HOST,
        port,
        development: false,
        fetch: (request, server) =>
          BoardServer.answer({
            request,
            server,
            token,
            hostname,
            collect: opts.collect,
            tokens: opts.tokens,
          }),
        error: (error) => {
          process.stderr.write(`board: a request failed: ${error.message}\n`);

          return new Response(null, { status: 500 });
        },
      });
    let note: string | undefined;
    let server: Server<undefined>;

    try {
      server = listen(opts.port);
    } catch (error) {
      if (
        opts.port === 0 ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EADDRINUSE'
      ) {
        throw error;
      }

      server = listen(0);
      note = `port ${opts.port} is busy: using ${server.port}`;
    }

    const run: IBoardServerRun = {
      server,
      token,
      clients: new Set(),
      latest: BoardServer.frameOf({ data: opts.collect(), max }),
      max,
      stopWatch: () => undefined,
      timers: [],
      origin: `http://${hostname}:${server.port}`,
      now: opts.now ?? Date.now,
    };
    const publish = (): void => {
      const data = BoardServer.snapshotOf({ collect: opts.collect });

      if (data === undefined) {
        return;
      }

      run.latest = BoardServer.frameOf({ data, max });

      for (const client of run.clients) {
        BoardServer.send({ clients: run.clients, client, text: run.latest });
      }
    };

    BoardServer.run = run;
    run.stopWatch = BoardWatch.start({ dir: opts.dir, onChange: publish });
    run.timers.push(
      setInterval(publish, BoardServe.REFRESH_MS),
      setInterval(() => {
        for (const client of run.clients) {
          BoardServer.send({ clients: run.clients, client, text: ': ping\n\n' });
        }
      }, BoardServe.HEARTBEAT_MS),
    );

    const path = BoardServer.pathWithToken({ path: BoardServe.PAGE_PATH, token });

    return {
      url: `http://${hostname}:${server.port}${path}`,
      fallback: `http://${BoardServe.HOST}:${server.port}${path}`,
      ...(note === undefined ? {} : { note }),
    };
  }

  /**
   * A fresh address for the program that opens the browser, `/open/<code>`: it holds no token. The code works once and
   * for `OPEN_CODE_TTL_MS`, and a call replaces the code before it; the server answers it with a redirect to the page
   * with the token. `undefined` when no server runs.
   */
  static openUrl(): string | undefined {
    const { run } = BoardServer;

    if (run === undefined) {
      return undefined;
    }

    const code = randomBytes(BoardServe.OPEN_CODE_BYTES).toString('hex');

    run.open = { code, expiresAt: run.now() + BoardServe.OPEN_CODE_TTL_MS };

    return `${run.origin}${BoardServe.OPEN_PATH}${code}`;
  }

  /** Whether `code` is the live open code; it is used up when it is. A wrong code leaves the live one alone. */
  private static redeem(opts: { code: string }): boolean {
    const { run } = BoardServer;
    const open = run?.open;

    if (
      run === undefined ||
      open === undefined ||
      !BoardServer.isToken({ given: opts.code, token: open.code })
    ) {
      return false;
    }

    run.open = undefined;

    return run.now() <= open.expiresAt;
  }

  /** Stops the server, the watch and the timers, and ends every open stream. */
  static async stop(): Promise<void> {
    const { run } = BoardServer;

    if (run === undefined) {
      return;
    }

    BoardServer.run = undefined;
    run.stopWatch();

    for (const timer of run.timers) {
      clearInterval(timer);
    }

    for (const client of run.clients) {
      client.close();
    }

    await run.server.stop(true);
  }

  /** Both sides are hashed, so the comparison is over 32 bytes each whatever the token text is, multibyte included. */
  private static isToken(opts: { given: string; token: string }): boolean {
    const digest = (text: string): Buffer => createHash('sha256').update(text).digest();

    return timingSafeEqual(digest(opts.given), digest(opts.token));
  }

  private static pathWithToken(opts: { path: string; token: string }): string {
    return `${opts.path}?${BoardServe.TOKEN_PARAM}=${opts.token}`;
  }

  /** The folded board, or `undefined` with one line on stderr when it cannot be read (a log file the user cannot open, say). */
  private static snapshotOf(opts: { collect: () => IBoardData }): IBoardData | undefined {
    try {
      return opts.collect();
    } catch (error) {
      process.stderr.write(
        `board: cannot read the board: ${error instanceof Error ? error.message : String(error)}\n`,
      );

      return undefined;
    }
  }

  /** One SSE message: the snapshot, or a notice that it is over the cap in bytes. A JSON text has no raw line break, so it is one `data:` line. */
  private static frameOf(opts: { data: IBoardData; max: number }): string {
    const json = JSON.stringify(opts.data);

    return Buffer.byteLength(json) > opts.max ? 'data: {"tooLarge":true}\n\n' : `data: ${json}\n\n`;
  }

  /** A client whose stream errored is dropped; one that has not read what it was sent (a full queue) skips this message instead of piling up. */
  static send(opts: {
    clients: Set<ReadableStreamDefaultController<Uint8Array>>;
    client: ReadableStreamDefaultController<Uint8Array>;
    text: string;
  }): void {
    const { desiredSize } = opts.client;

    if (desiredSize === null) {
      opts.clients.delete(opts.client);

      return;
    }

    if (desiredSize > 0) {
      opts.client.enqueue(encoder.encode(opts.text));
    }
  }

  private static answer(opts: {
    request: Request;
    server: Server<undefined>;
    token: string;
    hostname: string;
    collect: () => IBoardData;
    tokens?: IThemeTokens;
  }): Response {
    const { request, server, token } = opts;
    const verdict = BoardServer.check({
      method: request.method,
      url: request.url,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      port: server.port ?? 0,
      token,
      hostname: opts.hostname,
    });

    if (verdict.route === BoardRoutes.PAGE) {
      const data = BoardServer.snapshotOf({ collect: opts.collect });

      if (data === undefined) {
        return new Response(null, { status: 503 });
      }

      const live = { stream: BoardServer.pathWithToken({ path: BoardServe.STREAM_PATH, token }) };

      return new Response(BoardPage.render({ data: { ...data, live }, tokens: opts.tokens }), {
        headers: PAGE_HEADERS,
      });
    }

    if (verdict.route === BoardRoutes.OPEN) {
      return verdict.code !== undefined && BoardServer.redeem({ code: verdict.code })
        ? new Response(null, {
            status: 302,
            headers: {
              location: BoardServer.pathWithToken({ path: BoardServe.PAGE_PATH, token }),
              'cache-control': 'no-store',
              'referrer-policy': 'no-referrer',
            },
          })
        : new Response(null, { status: 403 });
    }

    if (verdict.route === BoardRoutes.STREAM) {
      return BoardServer.openStream({ request, server });
    }

    return new Response(null, { status: verdict.status });
  }

  private static openStream(opts: { request: Request; server: Server<undefined> }): Response {
    const { run } = BoardServer;

    if (run === undefined || run.clients.size >= BoardServe.MAX_STREAMS) {
      return new Response(null, { status: 503 });
    }

    opts.server.timeout(opts.request, 0);

    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>(
      {
        start: (started) => {
          controller = started;
          run.clients.add(started);
          BoardServer.send({
            clients: run.clients,
            client: started,
            text: `retry: 3000\n\n${run.latest}`,
          });
        },
        cancel: () => {
          if (controller !== undefined) {
            run.clients.delete(controller);
          }
        },
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 2 * run.max }),
    );

    return new Response(body, { headers: STREAM_HEADERS });
  }
}
