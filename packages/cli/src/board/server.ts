import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BoardRoutes, BoardServe } from './common/index.ts';
import type { IBoardData, TBoardRoute } from './common/index.ts';
import { BoardPage } from './page.ts';
import { BoardWatch } from './watch.ts';

interface IBoardServerOptions {
  port: number;
  /** The events folder to watch; a read of the board happens when it changes. */
  dir: string;
  /** The folded board, as `vulcan board` makes it. */
  collect: () => IBoardData;
  maxSnapshotBytes?: number;
}

interface IBoardServerRun {
  server: ReturnType<typeof Bun.serve>;
  token: string;
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
  latest: string;
  stopWatch: () => void;
  timers: ReturnType<typeof setInterval>[];
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
 * It reads and writes nothing of the project; every request must carry this run's token and a local Host and Origin.
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
  }): { status: number; route?: TBoardRoute } {
    const names = [`127.0.0.1:${opts.port}`, `localhost:${opts.port}`];

    if (opts.host === null || !names.includes(opts.host)) {
      return { status: 403 };
    }

    if (opts.origin !== null && !names.some((name) => opts.origin === `http://${name}`)) {
      return { status: 403 };
    }

    const url = new URL(opts.url);
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
  static async start(opts: IBoardServerOptions): Promise<{ url: string; note?: string }> {
    await BoardServer.stop();

    const token = randomBytes(BoardServe.TOKEN_BYTES).toString('hex');
    const max = opts.maxSnapshotBytes ?? BoardServe.MAX_SNAPSHOT_BYTES;
    const handle = (
      request: Request,
      server: { port?: number; timeout: (request: Request, seconds: number) => void },
    ) => BoardServer.answer({ request, server, token, collect: opts.collect });
    const listen = (port: number) => Bun.serve({ hostname: BoardServe.HOST, port, fetch: handle });
    let note: string | undefined;
    let server: ReturnType<typeof Bun.serve>;

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
      stopWatch: () => undefined,
      timers: [],
    };
    const publish = (): void => {
      run.latest = BoardServer.frameOf({ data: opts.collect(), max });

      for (const client of run.clients) {
        BoardServer.send({ run, client, text: run.latest });
      }
    };

    BoardServer.run = run;
    run.stopWatch = BoardWatch.start({ dir: opts.dir, onChange: publish });
    run.timers.push(
      setInterval(publish, BoardServe.REFRESH_MS),
      setInterval(() => {
        for (const client of run.clients) {
          BoardServer.send({ run, client, text: ': ping\n\n' });
        }
      }, BoardServe.HEARTBEAT_MS),
    );

    return {
      url: `http://${BoardServe.HOST}:${server.port}${BoardServe.PAGE_PATH}?${BoardServe.TOKEN_PARAM}=${token}`,
      ...(note === undefined ? {} : { note }),
    };
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

  private static isToken(opts: { given: string; token: string }): boolean {
    return (
      opts.given.length === opts.token.length &&
      timingSafeEqual(Buffer.from(opts.given), Buffer.from(opts.token))
    );
  }

  /** One SSE message: the snapshot, or a notice that it is over the cap. A JSON text has no raw line break, so it is one `data:` line. */
  private static frameOf(opts: { data: IBoardData; max: number }): string {
    const json = JSON.stringify(opts.data);

    return json.length > opts.max ? 'data: {"tooLarge":true}\n\n' : `data: ${json}\n\n`;
  }

  private static send(opts: {
    run: IBoardServerRun;
    client: ReadableStreamDefaultController<Uint8Array>;
    text: string;
  }): void {
    if (opts.client.desiredSize === null) {
      opts.run.clients.delete(opts.client);

      return;
    }

    opts.client.enqueue(encoder.encode(opts.text));
  }

  private static answer(opts: {
    request: Request;
    server: { port?: number; timeout: (request: Request, seconds: number) => void };
    token: string;
    collect: () => IBoardData;
  }): Response {
    const { request, server, token } = opts;
    const verdict = BoardServer.check({
      method: request.method,
      url: request.url,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      port: server.port ?? 0,
      token,
    });

    if (verdict.route === BoardRoutes.PAGE) {
      const data = {
        ...opts.collect(),
        live: { stream: `${BoardServe.STREAM_PATH}?${BoardServe.TOKEN_PARAM}=${token}` },
      };

      return new Response(BoardPage.render({ data }), { headers: PAGE_HEADERS });
    }

    if (verdict.route === BoardRoutes.STREAM) {
      return BoardServer.openStream({ request, server });
    }

    return new Response(null, { status: verdict.status });
  }

  private static openStream(opts: {
    request: Request;
    server: { timeout: (request: Request, seconds: number) => void };
  }): Response {
    const { run } = BoardServer;

    if (run === undefined || run.clients.size >= BoardServe.MAX_STREAMS) {
      return new Response(null, { status: 503 });
    }

    opts.server.timeout(opts.request, 0);

    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (started) => {
        controller = started;
        run.clients.add(started);
        BoardServer.send({ run, client: started, text: `retry: 3000\n\n${run.latest}` });
      },
      cancel: () => {
        if (controller !== undefined) {
          run.clients.delete(controller);
        }
      },
    });

    return new Response(body, { headers: STREAM_HEADERS });
  }
}
