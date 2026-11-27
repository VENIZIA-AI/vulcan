import { spyOn } from 'bun:test';
import { SourceResolver } from '@/sources/resolver';
import { SymbolCompute } from '@/symbols/compute';
import type { CapturedStderr } from '../helpers/stderr.helper';

/**
 * The npm symbol fetches a test starts. A start from cache and a live refresh leave them running, so
 * a test waits for them before it claims what they wrote.
 */
export class SymbolFetches {
  private readonly fetched = spyOn(SymbolCompute, 'symbolsOfPublished');
  private readonly refreshed = spyOn(SourceResolver, 'resolveRemote');

  static watch(): SymbolFetches {
    return new SymbolFetches();
  }

  /** Resolves once no watched call is running and none has started another. */
  async settled(): Promise<void> {
    let seen = -1;

    while (seen !== this.count()) {
      seen = this.count();
      await Promise.allSettled(
        [...this.refreshed.mock.results, ...this.fetched.mock.results].map(
          (result): unknown => result.value,
        ),
      );
      // A fetch logs its failure, then asks for the next package, after the rejection is handled.
      await Bun.sleep(0);
    }
  }

  /**
   * The registry refuses (NO_REGISTRY): claims the lines saying that a package's symbols are still
   * missing, exactly `times` of them, or one or more when timing decides the count (`some`).
   */
  async claimUnfetched(opts: {
    stderr: CapturedStderr;
    release?: string;
    source?: string;
    times?: number;
    some?: boolean;
  }): Promise<void> {
    await this.settled();

    const parts = [
      `[fetchPublishedSymbols] no symbols for ${opts.release ?? '@x/kernel@1.0.0'} yet`,
      `| source: ${opts.source ?? 'src'} |`,
      'ECONNREFUSED',
    ];

    if (opts.some === true) {
      opts.stderr.claimSome({ parts });

      return;
    }

    opts.stderr.claim({ parts, times: opts.times });
  }

  restore(): void {
    this.fetched.mockRestore();
    this.refreshed.mockRestore();
  }

  private count(): number {
    return this.refreshed.mock.calls.length + this.fetched.mock.calls.length;
  }
}
