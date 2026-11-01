import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepositoryRoot } from '@venizia/dev-configs/testing';

/** What a measuring run is asked: the page text, the width of the window, and the colour scheme. */
export interface IBrowserRun {
  html: string;
  width: number;
  dark: boolean;
  /** An expression run in the page; its JSON result is returned. */
  expression: string;
}

/**
 * A real browser for the tests that need layout: headless Chrome over the DevTools protocol, started once and reused.
 * `BrowserPage.available()` says whether one can be started here; a test that needs it is skipped when it cannot, and
 * says so, never passes silently.
 */
export class BrowserPage {
  private static child: ReturnType<typeof Bun.spawn> | undefined;
  private static socket: WebSocket | undefined;
  private static folder: string | undefined;
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

    // Chrome puts a unix socket in its temp folder, and a socket path is 107 characters at most: the child gets a short
    // folder, in this order - the one named by VULCAN_BROWSER_TMPDIR, the project's own `.agents/local`, the test folder.
    const candidates = [
      process.env['VULCAN_BROWSER_TMPDIR'],
      join(findRepositoryRoot(import.meta.dir), '.agents', 'local'),
      folder,
    ].filter((entry): entry is string => entry !== undefined && existsSync(entry));

    for (const short of candidates) {
      const started = await BrowserPage.start({ binary, folder, short });

      if (started) {
        return true;
      }
    }

    BrowserPage.close();

    return false;
  }

  private static async start(opts: {
    binary: string;
    folder: string;
    short: string;
  }): Promise<boolean> {
    const { binary, folder, short } = opts;

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

    BrowserPage.child?.kill();
    BrowserPage.child = undefined;
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
    writeFileSync(file, run.html);

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

    await BrowserPage.send({ method: 'Page.navigate', params: { url: `file://${file}` } });
    await loaded;
    await Bun.sleep(150);

    const result = await BrowserPage.send({
      method: 'Runtime.evaluate',
      params: { expression: run.expression, returnByValue: true },
    });

    return result.result.value as TResult;
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

  static close(): void {
    BrowserPage.socket?.close();
    BrowserPage.child?.kill();
    BrowserPage.socket = undefined;
    BrowserPage.child = undefined;

    if (BrowserPage.folder !== undefined) {
      rmSync(BrowserPage.folder, { recursive: true, force: true });
      BrowserPage.folder = undefined;
    }
  }
}
