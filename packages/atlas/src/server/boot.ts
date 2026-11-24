import { existsSync } from 'node:fs';
import { availableParallelism, freemem } from 'node:os';
import { join } from 'node:path';
import { StderrLogger } from '@/common/logger';
import type { IAtlasSource, IResolvedSource, IUnavailableSource } from '@/sources/common';
import type { ISourceMemory } from './status';

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
  /** What the last runs recorded: with it a source is served from its last good index at once, while it is checked again. */
  memory?: ISourceMemory;
  /** A monotonic clock in milliseconds, for durations; default `performance.now`. */
  now?: () => number;
}

/** How far one source is, for the notice and for `status`. */
export interface ISourceProgress {
  source: string;
  /** `waiting` for a free slot, `building` in a child, `ready` once it is served. */
  state: 'waiting' | 'building' | 'ready' | 'failed';
  /** Milliseconds since it began building; 0 while waiting or when ready. */
  elapsedMs: number;
  /** About how long a build takes, from the last successful one; absent when none was recorded. */
  expectedMs?: number;
  /** Served from the last good index while the remote is checked again. */
  isStale: boolean;
  /** What the stale index is: the commit and, when pinned, the tag it was built at. */
  staleAt?: string;
  /** Why the last check of a source served from an older index failed. */
  refreshError?: string;
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
  /** Sources served from their last good index while a child checks the remote again. */
  private readonly stale = new Set<string>();
  /** Sources that have been handed to the server, stale or fresh: the first time counts for waiting calls, once. */
  private readonly handedOver = new Set<string>();
  private readonly startedAt = new Map<string, number>();
  private readonly staleAt = new Map<string, string>();
  private readonly refreshErrors = new Map<string, string>();
  private readonly expected = new Map<string, number | undefined>();
  private readonly done: Promise<void>;
  private readonly settledBy = new Map<string, { promise: Promise<void>; finish: () => void }>();
  private finish!: () => void;
  private readonly freshDone: Promise<void>;
  private finishFresh!: () => void;
  private freshRemaining: number;
  private handlers: {
    /** `isReplacement`: the source was already served from its last good index and this is the fresh one. */
    onReady?: (opts: { resolved: IResolvedSource; isReplacement?: boolean }) => void;
    onFailed?: (opts: { unavailable: IUnavailableSource }) => void;
  } = {};
  private started = false;
  private remaining: number;

  constructor(opts: IBootOptions) {
    this.options = opts;
    this.waiting = [...opts.sources];
    this.remaining = opts.sources.length;
    this.freshRemaining = opts.sources.length;

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
    this.freshDone = new Promise((resolve) => {
      this.finishFresh = resolve;
    });

    if (this.remaining === 0) {
      this.finish();
      this.finishFresh();
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
    onReady: (opts: { resolved: IResolvedSource; isReplacement?: boolean }) => void;
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

    this.options.memory?.prune({ keep: this.options.sources.map((source) => source.name) });

    for (const source of this.options.sources) {
      this.expected.set(source.name, this.options.memory?.expectedMs({ source }));
    }

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

  /** The sources not served yet and not failed, in the order the config lists them. A source served from its last good index is not among them. */
  indexing(): IAtlasSource[] {
    return this.options.sources.filter(
      (source) =>
        !this.stale.has(source.name) &&
        (this.waiting.includes(source) || [...this.running.values()].includes(source)),
    );
  }

  /** Where every declared source stands: waiting, building (since when, how long it usually takes) or ready. */
  progress(): ISourceProgress[] {
    const now = (this.options.now ?? performance.now.bind(performance))();

    return this.options.sources.map((source) => {
      const isStale = this.stale.has(source.name);
      const began = this.startedAt.get(source.name);
      const isBuilding = [...this.running.values()].includes(source);
      const expectedMs = this.expected.get(source.name);
      const isFailed = this.failed.some((entry) => entry.source.name === source.name);
      const isReady = this.handedOver.has(source.name) && !isBuilding && !isFailed;

      return {
        source: source.name,
        state: isFailed ? 'failed' : isReady ? 'ready' : isBuilding ? 'building' : 'waiting',
        elapsedMs: isBuilding && began !== undefined ? now - began : 0,
        ...(expectedMs === undefined ? {} : { expectedMs }),
        isStale,
        ...(this.staleAt.has(source.name) ? { staleAt: this.staleAt.get(source.name) } : {}),
        ...(this.refreshErrors.has(source.name)
          ? { refreshError: this.refreshErrors.get(source.name) }
          : {}),
      };
    });
  }

  /** The sources that failed, with the reason. */
  unavailable(): IUnavailableSource[] {
    return [...this.failed];
  }

  /** Resolves when every source is ready or failed, a source served from an older index counting as ready. */
  get settled(): Promise<void> {
    return this.done;
  }

  /** Resolves when every source's own build has finished, fresh or failed: what `migrate` and `tools` wait for, never an older index. */
  get fresh(): Promise<void> {
    return this.freshDone;
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

  /** The first time a source is handed to the server, or fails: the calls that wait for it are released, once. */
  private settle(opts: { name: string }): void {
    if (this.handedOver.has(opts.name)) {
      return;
    }

    this.handedOver.add(opts.name);
    this.settledBy.get(opts.name)?.finish();
    this.remaining -= 1;

    if (this.remaining === 0) {
      this.finish();
    }
  }

  private async work(): Promise<void> {
    const { memory } = this.options;
    const now = this.options.now ?? performance.now.bind(performance);

    for (let source = this.waiting.shift(); source !== undefined; source = this.waiting.shift()) {
      let last = memory?.lastGood({ source });

      this.running.set(source.name, source);
      this.startedAt.set(source.name, now());

      // The last good index answers at once; the child checks the remote and replaces it when it has something newer.
      // A hand-over that throws (a corrupted index, a prune racing it) is a normal build from nothing.
      if (last !== undefined) {
        try {
          this.stale.add(source.name);
          this.staleAt.set(source.name, SourceBoot.describeStale({ resolved: last }));
          this.handlers.onReady?.({ resolved: last });
          this.settle({ name: source.name });
        } catch (error) {
          StderrLogger.get('SourceBoot').warn(
            'the last good index could not be opened, the source is built again | source: %s | error: %s',
            source.name,
            error instanceof Error ? error.message : String(error),
          );
          this.stale.delete(source.name);
          this.staleAt.delete(source.name);
          last = undefined;
        }
      }

      memory?.record({
        source,
        entry: { state: 'building', since: Date.now(), pid: process.pid },
      });

      try {
        const resolved = await this.options.indexer({ source });
        const durationMs = now() - (this.startedAt.get(source.name) ?? now());

        this.running.delete(source.name);
        this.stale.delete(source.name);
        this.staleAt.delete(source.name);
        this.refreshErrors.delete(source.name);
        memory?.record({
          source,
          entry: { state: 'ready', since: Date.now(), durationMs, resolved },
        });
        this.handlers.onReady?.({ resolved, isReplacement: last !== undefined });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        this.running.delete(source.name);
        memory?.record({ source, entry: { state: 'failed', since: Date.now(), error: reason } });

        if (last !== undefined) {
          // The last good index keeps answering; the failure is recorded, shown in the notice and tried again by the next start.
          this.stale.delete(source.name);
          this.refreshErrors.set(source.name, reason);
          StderrLogger.get('SourceBoot').warn(
            'source not refreshed, the last good index is served | source: %s | reason: %s',
            source.name,
            reason,
          );
        } else {
          const unavailable = { source, reason };

          this.failed.push(unavailable);
          StderrLogger.get('SourceBoot').warn(
            'source not served | source: %s | reason: %s',
            source.name,
            reason,
          );
          this.handlers.onFailed?.({ unavailable });
        }
      }

      this.settle({ name: source.name });
      this.freshRemaining -= 1;

      if (this.freshRemaining === 0) {
        this.finishFresh();
      }
    }
  }

  /** What a served-stale source is, in the words of the notice: its tag when pinned, else the short commit. */
  static describeStale(opts: { resolved: IResolvedSource }): string {
    const { pin, sha } = opts.resolved;

    return pin?.pinned === true ? pin.ref : (sha ?? 'an earlier build').slice(0, 7);
  }
}
