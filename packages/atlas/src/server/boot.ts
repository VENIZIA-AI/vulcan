import { existsSync } from 'node:fs';
import { availableParallelism, freemem } from 'node:os';
import { join } from 'node:path';
import { StderrLogger } from '@/common/logger';
import type { IAtlasSource, IResolvedSource, IUnavailableSource } from '@/sources/common';

/** What one index build holds at its peak (460 MB measured on the largest source of a real project, rounded up); the builds at once are capped by free memory over it. */
const SIGNAL_EXIT_CODES = { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 } as const;
const children = new Set<{ kill: () => void }>();
let exitHooked = false;

/** One `exit` handler for every child ever started: a server that ends takes its children with it. */
const killChildrenOnExit = (): void => {
  if (exitHooked) {
    return;
  }

  exitHooked = true;
  process.once('exit', () => {
    for (const child of children) {
      child.kill();
    }
  });
};
const BUILD_MEMORY_BYTES = 640 * 1024 ** 2;
const DEFAULT_CALL_WAIT_MS = 20_000;
const DEFAULT_BUILD_TIMEOUT_MS = 600_000;
/** How long a child that has printed its source may go on filling the symbol cache. */
const EXIT_GRACE_MS = 60_000;

export type TSourceIndexer = (opts: { source: IAtlasSource }) => Promise<IResolvedSource>;

interface IBootOptions {
  /** The declared remote sources, in the order the config lists them. */
  sources: IAtlasSource[];
  /** Fetches and indexes one source; a throw marks it failed and never stops the others. */
  indexer: TSourceIndexer;
  /** Builds at once; default `SourceBoot.concurrencyOf()`. */
  concurrency?: number;
}

/**
 * The remote sources of a server that is already answering: each is fetched and indexed in the
 * background, a bounded number at a time, and handed to the server when ready. A source that fails
 * is set aside with its reason and never blocks the others. Nothing here touches stdio.
 */
export class SourceBoot {
  private readonly options: IBootOptions;
  private readonly waiting: IAtlasSource[];
  private readonly running = new Map<string, IAtlasSource>();
  private readonly failed: IUnavailableSource[] = [];
  private readonly done: Promise<void>;
  private readonly settledBy = new Map<string, { promise: Promise<void>; finish: () => void }>();
  private finish!: () => void;
  private handlers: {
    onReady?: (opts: { resolved: IResolvedSource }) => void;
    onFailed?: (opts: { unavailable: IUnavailableSource }) => void;
  } = {};
  private started = false;
  private remaining: number;

  constructor(opts: IBootOptions) {
    this.options = opts;
    this.waiting = [...opts.sources];
    this.remaining = opts.sources.length;

    for (const source of opts.sources) {
      let finish!: () => void;
      const promise = new Promise<void>((resolve) => {
        finish = resolve;
      });

      this.settledBy.set(source.name, { promise, finish });
    }

    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });

    if (this.remaining === 0) {
      this.finish();
    }
  }

  /** Builds at once: the core count, held back by free memory, at least one; `VULCAN_ATLAS_INDEX_JOBS` overrides. */
  static concurrencyOf(): number {
    const configured = Number(process.env.VULCAN_ATLAS_INDEX_JOBS);

    if (Number.isInteger(configured) && configured > 0) {
      return configured;
    }

    return Math.max(
      1,
      Math.min(availableParallelism(), Math.floor(freemem() / BUILD_MEMORY_BYTES)),
    );
  }

  /** How long a call waits for the sources still indexing: `VULCAN_ATLAS_CALL_WAIT_SECONDS`, 20 s by default. */
  static callWaitMs(): number {
    const seconds = Number(process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS);

    return Number.isFinite(seconds) && seconds >= 0 && process.env.VULCAN_ATLAS_CALL_WAIT_SECONDS
      ? Math.round(seconds * 1000)
      : DEFAULT_CALL_WAIT_MS;
  }

  /** How long one source may take to fetch and index: `VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS`, ten minutes by default. */
  static buildTimeoutMs(): number {
    const seconds = Number(process.env.VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS);

    return Number.isFinite(seconds) && seconds > 0 && process.env.VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS
      ? Math.round(seconds * 1000)
      : DEFAULT_BUILD_TIMEOUT_MS;
  }

  /** Where the atlas command line lives next to this module: `cli.ts` from source, `cli.js` from the build. */
  static cliPath(): string {
    const base = join(__dirname, '..');

    return [join(base, 'cli.ts'), join(base, 'cli.js')].find((path) => existsSync(path)) ?? '';
  }

  /**
   * Fetches and indexes one source in a child process (`pull --warm --json`): the build is synchronous
   * work, so only another process leaves the server free to answer. The child prints the resolved
   * source as one JSON line; its other output is relayed to stderr. A child that exits without the
   * line, or runs past the timeout, fails the source.
   */
  static async indexInChild(opts: {
    source: IAtlasSource;
    args: string[];
    timeoutMs: number;
  }): Promise<IResolvedSource> {
    const child = Bun.spawn(
      [
        process.execPath,
        SourceBoot.cliPath(),
        'pull',
        '--warm',
        '--json',
        '--only',
        opts.source.name,
        ...opts.args,
      ],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);

    children.add(child);
    killChildrenOnExit();
    child.exited.then(() => children.delete(child)).catch(() => undefined);
    const tail: string[] = [];
    const errors = new TextDecoder();
    const relay = (async () => {
      for await (const chunk of child.stderr) {
        const text = errors.decode(chunk, { stream: true });

        process.stderr.write(text);
        tail.push(...text.split('\n').filter((line) => line.trim() !== ''));
      }
    })();
    let line: string | undefined;
    let buffer = '';
    const output = new TextDecoder();

    for await (const chunk of child.stdout) {
      buffer += output.decode(chunk, { stream: true });

      const newline = buffer.indexOf('\n');

      if (newline !== -1) {
        line = buffer.slice(0, newline);

        break;
      }
    }

    if (line !== undefined) {
      // The child may still be filling its caches (npm symbols): it is not waited for, only kept from running on for ever.
      clearTimeout(timer);
      setTimeout(() => child.kill(), EXIT_GRACE_MS).unref();

      const source: IResolvedSource | null = JSON.parse(line).source;

      if (source === null) {
        throw new Error(`indexing ${opts.source.name} produced no source`);
      }

      return source;
    }

    const code = await child.exited;

    clearTimeout(timer);
    await relay;

    throw new Error(
      timedOut
        ? `indexing ${opts.source.name} took longer than ${Math.round(opts.timeoutMs / 1000)} s and was stopped`
        : (tail.at(-1) ?? `indexing ${opts.source.name} exited with code ${code}`).replace(
            /^vulcan-atlas: /,
            '',
          ),
    );
  }

  /** The declared sources, in the order the config lists them. */
  get declared(): IAtlasSource[] {
    return this.options.sources;
  }

  /** What to do when a source is ready, and when one failed; set before `start()`. */
  listen(opts: {
    onReady: (opts: { resolved: IResolvedSource }) => void;
    onFailed?: (opts: { unavailable: IUnavailableSource }) => void;
  }): void {
    this.handlers = opts;
  }

  /** Starts the background work; a second call does nothing. */
  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    // A server stopped by a signal takes its children with it: the 'exit' handlers kill them.
    for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
      process.once(signal, () => process.exit(code));
    }

    const workers = Math.min(
      this.waiting.length,
      this.options.concurrency ?? SourceBoot.concurrencyOf(),
    );

    for (let index = 0; index < workers; index += 1) {
      this.work().catch(() => undefined);
    }
  }

  /** The sources not ready and not failed, in the order the config lists them. */
  indexing(): IAtlasSource[] {
    return this.options.sources.filter(
      (source) => this.waiting.includes(source) || [...this.running.values()].includes(source),
    );
  }

  /** The sources that failed, with the reason. */
  unavailable(): IUnavailableSource[] {
    return [...this.failed];
  }

  /** Resolves when every source is ready or failed. */
  get settled(): Promise<void> {
    return this.done;
  }

  /**
   * Resolves when the source named is ready or failed (every source when none is named), or when `ms`
   * has passed, whichever is first. A name that is not a declared source does not wait.
   */
  async waitFor(opts: { ms: number; source?: string }): Promise<void> {
    const target =
      opts.source === undefined
        ? this.done
        : (this.settledBy.get(opts.source)?.promise ?? this.done);

    if (opts.source === undefined ? this.remaining === 0 : !this.settledBy.has(opts.source)) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    await Promise.race([
      target,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, opts.ms);
      }),
    ]);
    clearTimeout(timer);
  }

  private async work(): Promise<void> {
    for (let source = this.waiting.shift(); source !== undefined; source = this.waiting.shift()) {
      this.running.set(source.name, source);

      try {
        const resolved = await this.options.indexer({ source });

        this.running.delete(source.name);
        this.handlers.onReady?.({ resolved });
      } catch (error) {
        const unavailable = {
          source,
          reason: error instanceof Error ? error.message : String(error),
        };

        this.running.delete(source.name);
        this.failed.push(unavailable);
        StderrLogger.get('SourceBoot').warn(
          'source not served | source: %s | reason: %s',
          source.name,
          unavailable.reason,
        );
        this.handlers.onFailed?.({ unavailable });
      }

      this.settledBy.get(source.name)?.finish();
      this.remaining -= 1;

      if (this.remaining === 0) {
        this.finish();
      }
    }
  }
}
