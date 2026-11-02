import type { SourceBoot } from './boot';

/** What a tool answer says about the sources it did not read. */
export interface ISourceNotice {
  answeredFrom: string[];
  indexing: string[];
  failed: { source: string; reason: string }[];
  message: string;
}

const NAMES_MAX = 6;

const listOf = (opts: { names: string[] }): string =>
  opts.names.length <= 1
    ? opts.names.join('')
    : `${opts.names.slice(0, -1).join(', ')} and ${opts.names[opts.names.length - 1]}`;

export class SourceNotice {
  /** `undefined` when every declared source is ready; otherwise which are still indexing, which failed, and what the answer covers. */
  static of(opts: { boot: SourceBoot; answeredFrom: string[] }): ISourceNotice | undefined {
    const indexing = opts.boot.indexing().map((source) => source.name);
    const failed = opts.boot
      .unavailable()
      .map((entry) => ({ source: entry.source.name, reason: entry.reason }));

    if (indexing.length === 0 && failed.length === 0) {
      return undefined;
    }

    const parts = [
      indexing.length === 0
        ? ''
        : `${listOf({ names: indexing.slice(0, NAMES_MAX) })} ${indexing.length === 1 ? 'is' : 'are'} still being indexed and ${indexing.length === 1 ? 'is' : 'are'} not searched yet`,
      ...failed.map(
        (entry) => `${entry.source} could not be indexed (${entry.reason}) and is not searched`,
      ),
    ].filter((part) => part !== '');

    return {
      answeredFrom: opts.answeredFrom,
      indexing,
      failed,
      message: `${parts.join('; ')}; this answer covers only ${opts.answeredFrom.length === 0 ? 'nothing yet' : listOf({ names: opts.answeredFrom })}${indexing.length > 0 ? '. Ask again in a minute for the rest' : ''}`,
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
