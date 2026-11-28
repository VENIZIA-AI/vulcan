import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { StderrLogger } from '@venizia/vulcan-okf';
import { LocalSettings } from '../common/local-settings.ts';
import { EventSettings } from '../events/settings.ts';
import { ProjectTmp } from '../hooks/project-tmp.ts';
import { BoardFlags, BoardServe } from './common/index.ts';
import type { TAutoStart } from './common/index.ts';
import { FallbackUtility } from '../common/utilities/fallback.utility.ts';

/** What answers on the port: a VULCAN board, another program, or nothing. */
type TPortState = 'board' | 'other' | 'free';

/** The variables a started board keeps: where programs are, who runs them and the language; no session id, actor or key. */
const KEPT_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG']);

/**
 * `board.serve.autoStart` (in the person's own `.agents/local/profile.json`) at the start of a session: with the event log on
 * and nothing answering on the board's port, `vulcan board serve --port <port>` is started as a detached process of the
 * project's own install (never a lookup on `PATH`) with a trimmed environment, its output going to
 * `.agents/tmp/board-serve.log`. An explicit `--port` makes a busy port an error, so a second start (two sessions at
 * once) exits and leaves no board on another port. Another program on the port is not touched: one line says so. It never
 * waits for the board and never throws.
 */
export class BoardAutoStart {
  /** Whether this machine asks for it (`board.serve.autoStart` of the local file) and the manifest has the event log on. Never throws. */
  static isOn(opts: { root: string }): boolean {
    return (
      LocalSettings.read({ root: opts.root }).autoStart === true &&
      EventSettings.read({ root: opts.root }).log
    );
  }

  /** What answers on the board's port: a refused connection is `free`; a reply with the board's identity header is `board`. */
  static portState(opts: { port: number }): Promise<TPortState> {
    return new Promise((done) => {
      const call = request(
        { host: BoardServe.HOST, port: opts.port, path: BoardServe.PAGE_PATH, method: 'GET' },
        (response) => {
          response.resume();
          done(
            response.headers[BoardServe.IDENTITY_HEADER] === BoardServe.IDENTITY_VALUE
              ? 'board'
              : 'other',
          );
        },
      );

      call.setTimeout(BoardServe.PROBE_MS, () => {
        call.destroy();
        done('other');
      });
      call.on('error', (error: NodeJS.ErrnoException) =>
        done(error.code === 'ECONNREFUSED' ? 'free' : 'other'),
      );
      call.end();
    });
  }

  static async tick(opts: { root: string; port?: number }): Promise<TAutoStart> {
    if (!BoardAutoStart.isOn({ root: opts.root })) {
      return 'off';
    }

    const port = opts.port ?? BoardServe.DEFAULT_PORT;
    const folder = ProjectTmp.projectOf({ root: opts.root });
    const state = await BoardAutoStart.portState({ port });

    if (state === 'board') {
      return 'running';
    }

    return FallbackUtility.of({
      read: () => {
        mkdirSync(folder, { recursive: true });

        if (state === 'other') {
          const note = `vulcan: [session-start] port ${port} is held by something that is not a VULCAN board, so no board was started`;

          appendFileSync(join(folder, BoardServe.AUTO_LOG), `${note}\n`, { mode: 0o600 });
          StderrLogger.note(note);

          return 'foreign';
        }

        const log = openSync(join(folder, BoardServe.AUTO_LOG), 'a', 0o600);
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => KEPT_ENV.has(name) || name.startsWith('LC_'),
          ),
        );
        const child = spawn(
          process.execPath,
          [
            '--no-env-file',
            '--config=/dev/null',
            join(opts.root, 'node_modules/.bin/vulcan'),
            'board',
            BoardServe.COMMAND,
            BoardFlags.PORT,
            String(port),
          ],
          { cwd: opts.root, detached: true, stdio: ['ignore', log, log], env },
        );

        child.on('error', () => undefined);
        child.unref();
        closeSync(log);

        return 'started';
      },
      otherwise: 'failed',
    });
  }
}
