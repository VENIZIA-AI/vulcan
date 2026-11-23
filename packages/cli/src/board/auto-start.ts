import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventSettings } from '../events/settings.ts';
import { BoardServe } from './common/index.ts';

/** What `tick` did, for a test and for the note the hook prints. */
export type TAutoStart = 'off' | 'running' | 'started' | 'failed';

/**
 * `board.serve.autoStart` at the start of a session: when the manifest asks for it and the event log is on, and nothing
 * answers on the board's port, `vulcan board serve` is started as a detached process of the project's own install
 * (never a lookup on `PATH`), its output going to `.agents/local/tmp/board-serve.log`. It never waits for the board and
 * never throws. Two sessions starting together can both start one: the second cannot bind and exits, and its log says so.
 */
export class BoardAutoStart {
  /** Whether the manifest turns it on: `board.serve.autoStart` and `events.log`. Never throws. */
  static isOn(opts: { root: string }): boolean {
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(join(opts.root, '.agents/vulcan.manifest.json'), 'utf8'),
      );
      const board = RecordValue.isRecord(manifest) ? manifest.board : undefined;
      const serve = RecordValue.isRecord(board) ? board.serve : undefined;

      return (
        RecordValue.isRecord(serve) &&
        serve.autoStart === true &&
        EventSettings.read({ root: opts.root }).log
      );
    } catch {
      return false;
    }
  }

  /** Whether something accepts a connection on the board's port of this machine. */
  static isListening(opts: { port: number }): Promise<boolean> {
    return new Promise((done) => {
      const socket = createConnection({ port: opts.port, host: BoardServe.HOST });
      const end = (value: boolean): void => {
        socket.destroy();
        done(value);
      };

      socket.setTimeout(BoardServe.PROBE_MS, () => end(false));
      socket.once('connect', () => end(true));
      socket.once('error', () => end(false));
    });
  }

  static async tick(opts: { root: string; port?: number }): Promise<TAutoStart> {
    if (!BoardAutoStart.isOn({ root: opts.root })) {
      return 'off';
    }

    const result = await BoardAutoStart.isListening({ port: opts.port ?? BoardServe.DEFAULT_PORT });
    if (result) {
      return 'running';
    }

    try {
      const folder = join(opts.root, '.agents/local/tmp');

      mkdirSync(folder, { recursive: true });

      const log = openSync(join(folder, BoardServe.AUTO_LOG), 'a', 0o600);
      const env = { ...process.env };

      for (const name of Object.keys(env)) {
        if (name === 'BUN_OPTIONS' || name === 'NODE_OPTIONS' || name.startsWith('BUN_CONFIG_')) {
          delete env[name];
        }
      }

      const child = spawn(
        process.execPath,
        [
          '--no-env-file',
          '--config=/dev/null',
          join(opts.root, 'node_modules/.bin/vulcan'),
          'board',
          'serve',
          ...(opts.port === undefined ? [] : ['--port', String(opts.port)]),
        ],
        { cwd: opts.root, detached: true, stdio: ['ignore', log, log], env },
      );

      child.on('error', () => undefined);
      child.unref();
      closeSync(log);

      return 'started';
    } catch {
      return 'failed';
    }
  }
}
