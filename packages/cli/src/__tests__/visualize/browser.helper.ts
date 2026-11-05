import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { findRepositoryRoot } from '@venizia/dev-configs/testing';
import { BrowserSocket } from '../../local/browser-socket.ts';

/** What a measuring run is asked: the page text, the width of the window, and the colour scheme. */
export interface IBrowserRun {
  /** The page text, written to a file and opened; or give `url` to open a page that is served. */
  html?: string;
  url?: string;
  width: number;
  dark: boolean;
  /** An expression run in the page; its JSON result is returned. */
  expression: string;
}

/** What a browser leaves in its temp folder when it is killed. */
const SCRATCH_FOLDER = /^\.?(com\.google\.Chrome|org\.chromium\.Chromium)\./;

/**
 * A real browser for the tests that need layout: headless Chrome over the DevTools protocol, started once and reused.
 * `BrowserPage.available()` says whether one can be started here; a test that needs it is skipped when it cannot, and
 * says so, never passes silently.
 */
export class BrowserPage {
  private static child: ReturnType<typeof Bun.spawn> | undefined;
  private static socket: WebSocket | undefined;
  private static folder: string | undefined;
  /** A temp folder made for this run alone, removed whole at the end. */
  private static privateTemp: string | undefined;
  private static profile: { dir: string; short: string } | undefined;
  private static nextId = 0;
  private static readonly waiting = new Map<number, (value: unknown) => void>();
  private static readonly listeners: ((method: string) => void)[] = [];

  /** The Chrome or Chromium binary on this machine, or undefined. */
  static binary(): string | undefined {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const found = Bun.which(name);

      if (found !== null) {
        return found;
      }
    }

    return undefined;
  }

  /** Starts the browser; false when there is none or it does not answer in time (for example a socket path that is too long). */
  static async available(): Promise<boolean> {
    if (BrowserPage.socket !== undefined) {
      return true;
    }

    const binary = BrowserPage.binary();

    if (binary === undefined) {
      return false;
    }

    const folder = mkdtempSync(join(tmpdir(), 'vz-browser-'));

    BrowserPage.folder = folder;

    // The child gets the first of these folders in which Chrome's socket path fits: the one named by
    // VULCAN_BROWSER_TMPDIR, the project's scratch folder, the project's `.agents/local` (shorter by `tmp/`), the test folder.
    const local = join(findRepositoryRoot(import.meta.dir), '.agents', 'local');
    const candidates = [
      process.env['VULCAN_BROWSER_TMPDIR'],
      join(local, 'tmp'),
      local,
      folder,
    ].filter(
      (entry): entry is string =>
        entry !== undefined && existsSync(entry) && BrowserSocket.fits({ folder: entry }),
    );

    for (const base of candidates) {
      // Where the path allows, Chrome gets a folder of this run alone: another run in the same folder is never
      // touched and everything its Chrome left goes with the folder. Otherwise only the folder its own link names goes.
      const own = mkdtempSync(join(base, 'vz-'));
      const isPrivate = BrowserSocket.fits({ folder: own });

      if (!isPrivate) {
        rmSync(own, { recursive: true, force: true });
      }

      BrowserPage.privateTemp = isPrivate ? own : undefined;

      const started = await BrowserPage.start({ binary, folder, short: isPrivate ? own : base });

      if (started) {
        return true;
      }
    }

    await BrowserPage.close();
    console.warn(
      candidates.length === 0
        ? `browser tests skipped: no folder is short enough for Chrome's socket (${BrowserSocket.PATH_MAX} characters at most, \`${BrowserSocket.longest()}\` included); set VULCAN_BROWSER_TMPDIR to a short folder`
        : 'browser tests skipped: Chrome did not answer in time',
    );

    return false;
  }

  private static async start(opts: {
    binary: string;
    folder: string;
    short: string;
  }): Promise<boolean> {
    const { binary, folder, short } = opts;

    BrowserPage.profile = { dir: join(folder, 'profile'), short };
    BrowserPage.child = Bun.spawn(
      [
        binary,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--remote-debugging-port=0',
        `--user-data-dir=${join(folder, 'profile')}`,
        'about:blank',
      ],
      { stdout: 'ignore', stderr: 'ignore', env: { ...process.env, TMPDIR: short } },
    );

    const portFile = join(folder, 'profile', 'DevToolsActivePort');

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (existsSync(portFile)) {
        const port = readFileSync(portFile, 'utf8').split('\n')[0];

        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`);
          const body: unknown = await response.json();
          const list = body as { type: string; webSocketDebuggerUrl: string }[];
          const page = list.find((entry) => entry.type === 'page');

          if (page !== undefined) {
            const connected = await BrowserPage.connect({ url: page.webSocketDebuggerUrl });

            return connected;
          }
        } catch {
          // Still starting.
        }
      }

      await Bun.sleep(150);
    }

    await BrowserPage.stopChild();
    rmSync(join(folder, 'profile'), { recursive: true, force: true });

    return false;
  }

  private static async connect(opts: { url: string }): Promise<boolean> {
    const socket = new WebSocket(opts.url);

    await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
    socket.addEventListener('message', (message) => {
      const data = JSON.parse(String(message.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
        error?: unknown;
      };

      if (data.id !== undefined) {
        BrowserPage.waiting.get(data.id)?.(data.result ?? data.error);
        BrowserPage.waiting.delete(data.id);
      } else if (data.method !== undefined) {
        const method = data.method;

        for (const listener of [...BrowserPage.listeners]) {
          listener(method);
        }
      }
    });
    BrowserPage.socket = socket;
    await BrowserPage.send({ method: 'Page.enable' });

    return true;
  }

  private static send(opts: { method: string; params?: object }): Promise<any> {
    return new Promise((resolve) => {
      BrowserPage.nextId += 1;
      BrowserPage.waiting.set(BrowserPage.nextId, resolve as (value: unknown) => void);
      BrowserPage.socket?.send(
        JSON.stringify({ id: BrowserPage.nextId, method: opts.method, params: opts.params ?? {} }),
      );
    });
  }

  /** Renders `html` at `width` in the colour scheme, runs the expression in it and returns its JSON result. */
  static async measure<TResult>(run: IBrowserRun): Promise<TResult> {
    const file = join(BrowserPage.folder!, `page-${BrowserPage.nextId}.html`);

    mkdirSync(BrowserPage.folder!, { recursive: true });

    if (run.url === undefined) {
      writeFileSync(file, run.html ?? '');
    }

    await BrowserPage.send({
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width: run.width, height: 900, deviceScaleFactor: 1, mobile: run.width < 500 },
    });
    await BrowserPage.send({
      method: 'Emulation.setEmulatedMedia',
      params: {
        features: [
          { name: 'prefers-color-scheme', value: run.dark ? 'dark' : 'light' },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      },
    });

    const loaded = new Promise<void>((resolve) => {
      const listener = (method: string): void => {
        if (method === 'Page.loadEventFired') {
          BrowserPage.listeners.splice(BrowserPage.listeners.indexOf(listener), 1);
          resolve();
        }
      };

      BrowserPage.listeners.push(listener);
    });

    await BrowserPage.send({
      method: 'Page.navigate',
      params: { url: run.url ?? `file://${file}` },
    });
    await loaded;
    await Bun.sleep(150);

    const result = await BrowserPage.send({
      method: 'Runtime.evaluate',
      params: { expression: run.expression, returnByValue: true, awaitPromise: true },
    });

    return result.result.value as TResult;
  }

  /** Runs an expression in the page that is already open, without navigating, and returns its result as text (JSON, when the expression returns `JSON.stringify(...)`). */
  static async evaluate(opts: { expression: string }): Promise<string> {
    const result = await BrowserPage.send({
      method: 'Runtime.evaluate',
      params: { expression: opts.expression, returnByValue: true, awaitPromise: true },
    });

    return String(result.result.value);
  }

  /** A screenshot of the whole page, for a human to look at (not used by an assertion). */
  static async screenshot(opts: { path: string; width: number }): Promise<void> {
    const metrics = await BrowserPage.send({ method: 'Page.getLayoutMetrics' });

    await BrowserPage.send({
      method: 'Emulation.setDeviceMetricsOverride',
      params: {
        width: opts.width,
        height: Math.ceil(metrics.cssContentSize.height),
        deviceScaleFactor: 1,
        mobile: opts.width < 500,
      },
    });
    await Bun.sleep(150);

    const shot = await BrowserPage.send({
      method: 'Page.captureScreenshot',
      params: { format: 'png' },
    });

    writeFileSync(opts.path, Buffer.from(shot.data as string, 'base64'));
  }

  /** A screenshot of one element (the first match of `selector`), for a human to look at. */
  static async screenshotOf(opts: {
    path: string;
    width: number;
    selector: string;
  }): Promise<boolean> {
    const metrics = await BrowserPage.send({ method: 'Page.getLayoutMetrics' });

    await BrowserPage.send({
      method: 'Emulation.setDeviceMetricsOverride',
      params: {
        width: opts.width,
        height: Math.ceil(metrics.cssContentSize.height),
        deviceScaleFactor: 1,
        mobile: opts.width < 500,
      },
    });
    await Bun.sleep(150);

    const found = await BrowserPage.send({
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => { const e = document.querySelector(${JSON.stringify(opts.selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`,
        returnByValue: true,
      },
    });
    const box = found.result.value as {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;

    if (box === null) {
      return false;
    }

    const shot = await BrowserPage.send({
      method: 'Page.captureScreenshot',
      params: { format: 'png', clip: { ...box, scale: 1 } },
    });

    writeFileSync(opts.path, Buffer.from(shot.data as string, 'base64'));

    return true;
  }

  /**
   * The scratch folder Chrome made for this run. Chrome links `<user data dir>/SingletonSocket` to
   * `<temp folder>/com.google.Chrome.XXXXXX/SingletonSocket`, and the user data dir is this run's own, so the link
   * names exactly the folder to remove, and a browser of another run in the same temp folder is never touched.
   * `undefined` when there is no link, or it points anywhere but a scratch folder directly in `short`.
   */
  static scratchOf(opts: { profile: string; short: string }): string | undefined {
    try {
      const target = readlinkSync(join(opts.profile, 'SingletonSocket'));
      const folder = dirname(resolvePath(opts.profile, target));

      return dirname(folder) === resolvePath(opts.short) && SCRATCH_FOLDER.test(basename(folder))
        ? folder
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Ends the browser (a hard kill when it does not leave in 3 seconds) and removes the scratch folder of this run's Chrome. */
  private static async stopChild(): Promise<void> {
    const { child, privateTemp, profile } = BrowserPage;
    // Read while the browser still runs: it removes its link when it leaves.
    const scratch =
      profile === undefined
        ? undefined
        : BrowserPage.scratchOf({ profile: profile.dir, short: profile.short });

    BrowserPage.child = undefined;
    BrowserPage.privateTemp = undefined;
    BrowserPage.profile = undefined;

    if (child !== undefined) {
      child.kill();

      const left = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(3000).then(() => false),
      ]);

      if (!left) {
        child.kill('SIGKILL');
        await child.exited;
      }
    }

    if (privateTemp !== undefined) {
      rmSync(privateTemp, { recursive: true, force: true });
    } else if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  static async close(): Promise<void> {
    BrowserPage.socket?.close();
    BrowserPage.socket = undefined;
    await BrowserPage.stopChild();

    if (BrowserPage.folder !== undefined) {
      rmSync(BrowserPage.folder, { recursive: true, force: true });
      BrowserPage.folder = undefined;
    }
  }
}
