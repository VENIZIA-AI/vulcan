import { StderrLogger } from '@/common/logger';

const DEFAULT_INTERVAL_MS = 300_000;

/**
 * How often a running server looks again at what it serves: `VULCAN_ATLAS_REFRESH_SECONDS`, five
 * minutes by default, and `undefined` (never) for `0`. An unreadable value is the default.
 */
export const refreshIntervalMs = (): number | undefined => {
  const raw = process.env.VULCAN_ATLAS_REFRESH_SECONDS;

  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_INTERVAL_MS;
  }

  const seconds = Number(raw);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_INTERVAL_MS;
  }

  return seconds === 0 ? undefined : Math.round(seconds * 1000);
};

export interface IRefreshTarget {
  /** Looks again at one source and replaces its stores when something changed; a throw keeps the old ones. */
  refresh: () => Promise<void>;
}

/**
 * A server process lives as long as its agent session - days - so what it resolved at its start goes
 * stale: a ref moves, a release tag is pushed. Every request pokes this; once the interval has
 * passed and no refresh runs, one starts in the background. A call never waits for it, and a target
 * that fails keeps what it served (an offline machine stays on its cache).
 */
export class Refresher {
  private readonly targets: IRefreshTarget[];
  private readonly intervalMs: number;
  private readonly now: () => number;
  private lastAt: number;
  private running: Promise<void> | undefined;

  constructor(opts: { targets: IRefreshTarget[]; intervalMs: number; now?: () => number }) {
    this.targets = opts.targets;
    this.intervalMs = opts.intervalMs;
    this.now = opts.now ?? Date.now;
    this.lastAt = this.now();
  }

  poke(): void {
    if (this.running !== undefined || this.now() - this.lastAt < this.intervalMs) {
      return;
    }

    this.lastAt = this.now();
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
  }

  /** Resolves once the refresh in progress, if any, has finished. */
  async idle(): Promise<void> {
    await this.running;
  }

  private async run(): Promise<void> {
    for (const target of this.targets) {
      try {
        await target.refresh();
      } catch (error) {
        StderrLogger.get('Refresher').warn(
          `kept what it served | error: %s`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
