import type { SourceBoot } from './boot';

/** What a tool answer says about the sources it did not read. */
export interface ISourceNotice {
  answeredFrom: string[];
  indexing: string[];
  failed: { source: string; reason: string }[];
  /** How far each source that is not ready has got: seconds spent, and the usual duration when one was recorded. */
  building: { source: string; elapsedSeconds: number; expectedSeconds?: number }[];
  /** Sources answered from an older index while they are checked again, with what the index is and why the last check failed, if it did. */
  stale: { source: string; at: string; refreshError?: string }[];
  /** `N of M sources are ready`, the project's own counted in both. */
  ready: { count: number; total: number };
  /** About how long until the sources that are building should be served; 30 when no duration was recorded. */
  retryInSeconds?: number;
  message: string;
}

const NAMES_MAX = 6;
const DEFAULT_RETRY_SECONDS = 30;
const MIN_RETRY_SECONDS = 5;

const listOf = (opts: { names: string[] }): string =>
  opts.names.length <= 1
    ? opts.names.join('')
    : `${opts.names.slice(0, -1).join(', ')} and ${opts.names[opts.names.length - 1]}`;

export class SourceNotice {
  /**
   * `undefined` when every declared source is ready; otherwise how many are, which are still building (and for how long,
   * against how long they usually take), which failed and why, what the answer covers, and when to ask again.
   */
  static of(opts: { boot: SourceBoot; answeredFrom: string[] }): ISourceNotice | undefined {
    const indexing = opts.boot.indexing().map((source) => source.name);
    const failed = opts.boot
      .unavailable()
      .map((entry) => ({ source: entry.source.name, reason: entry.reason }));

    const progress = opts.boot.progress();
    const stale = progress.flatMap((entry) =>
      entry.staleAt === undefined
        ? []
        : [
            {
              source: entry.source,
              at: entry.staleAt,
              ...(entry.refreshError === undefined ? {} : { refreshError: entry.refreshError }),
            },
          ],
    );

    if (indexing.length === 0 && failed.length === 0 && stale.length === 0) {
      return undefined;
    }

    const building = progress
      .filter((entry) => indexing.includes(entry.source))
      .map((entry) => ({
        source: entry.source,
        elapsedSeconds: Math.round(entry.elapsedMs / 1000),
        ...(entry.expectedMs === undefined
          ? {}
          : { expectedSeconds: Math.round(entry.expectedMs / 1000) }),
      }));
    const left = building.flatMap((entry) =>
      entry.expectedSeconds === undefined ? [] : [entry.expectedSeconds - entry.elapsedSeconds],
    );
    const retryInSeconds =
      building.length === 0
        ? undefined
        : Math.max(
            MIN_RETRY_SECONDS,
            left.length === 0 ? DEFAULT_RETRY_SECONDS : Math.max(...left),
          );
    const total = opts.answeredFrom.length + indexing.length + failed.length;
    const describe = (entry: (typeof building)[number]): string =>
      `${entry.source} is being indexed (${entry.elapsedSeconds} s so far${entry.expectedSeconds === undefined ? '' : `, usually about ${entry.expectedSeconds} s`})`;
    const parts = [
      ...building.slice(0, NAMES_MAX).map((entry) => describe(entry)),
      ...failed.map(
        (entry) => `${entry.source} could not be indexed (${entry.reason}) and is not searched`,
      ),
      ...stale.map((entry) =>
        entry.refreshError === undefined
          ? `${entry.source} is answered from ${entry.at} while it refreshes`
          : `${entry.source} could not be refreshed (${entry.refreshError}) and stays at ${entry.at}`,
      ),
    ];

    return {
      answeredFrom: opts.answeredFrom,
      indexing,
      failed,
      stale,
      building,
      ready: { count: opts.answeredFrom.length, total },
      ...(retryInSeconds === undefined ? {} : { retryInSeconds }),
      message: `${opts.answeredFrom.length} of ${total} sources are ready; ${parts.join('; ')}${indexing.length === 0 && failed.length === 0 ? '' : `; this answer covers only ${opts.answeredFrom.length === 0 ? 'nothing yet' : listOf({ names: opts.answeredFrom })}`}${retryInSeconds === undefined ? '' : `. Ask again in about ${retryInSeconds} s for the rest`}`,
    };
  }

  /** The tool's answer with the notice added when it is an object; any other answer is returned as it is. */
  static attach(opts: { result: unknown; notice: ISourceNotice | undefined }): unknown {
    const { result, notice } = opts;

    return notice === undefined ||
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result)
      ? result
      : { ...result, notServed: notice };
  }
}
