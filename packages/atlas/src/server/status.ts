import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IAtlasSource, IResolvedSource } from '@/sources/common';

/** What the last server run recorded about one source. */
export interface ISourceRecord {
  /** `building` while a child indexes it, `ready` once it is served, `failed` with the reason. */
  state: 'building' | 'ready' | 'failed';
  /** When the state began, milliseconds since the epoch. */
  since: number;
  /** How long the last successful build took; the next one is expected to take about as long. */
  durationMs?: number;
  /** The last error line of a failed build. */
  error?: string;
  /** The source as the last good build resolved it: a server that starts answers from it at once. */
  resolved?: IResolvedSource;
}

interface IStatusFile {
  version: 1;
  sources: Record<string, ISourceRecord>;
}

const EMPTY: IStatusFile = { version: 1, sources: {} };

/**
 * What a server remembers about its sources between starts, in one small file beside the cache (`atlas/status.json`),
 * so a server that starts can answer from the last good index while it checks the remote again, and `vulcan x atlas
 * status` and `vulcan doctor` can say what happened. A file that is missing, unreadable or of another version reads as
 * empty: it is a hint, never a source of truth, and it never stops a start.
 */
export class SourceStatus {
  /** `<cacheBase>/atlas/status.json`. */
  static fileOf(opts: { cacheBase: string }): string {
    return join(opts.cacheBase, 'atlas', 'status.json');
  }

  static read(opts: { file: string }): Record<string, ISourceRecord> {
    try {
      const parsed: IStatusFile = JSON.parse(readFileSync(opts.file, 'utf8'));

      return parsed.version === EMPTY.version && typeof parsed.sources === 'object'
        ? parsed.sources
        : {};
    } catch {
      return {};
    }
  }

  /** Writes one source's record: read again, changed, written to a temporary file and renamed, so a reader never sees half of it. */
  static record(opts: { file: string; name: string; entry: ISourceRecord }): void {
    try {
      const sources = { ...SourceStatus.read({ file: opts.file }), [opts.name]: opts.entry };
      const temporary = `${opts.file}.${process.pid}.tmp`;

      mkdirSync(dirname(opts.file), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify({ version: 1, sources }, null, 2)}\n`);
      renameSync(temporary, opts.file);
    } catch {
      // The record is a hint: a folder that cannot be written is no reason to stop serving.
    }
  }
}

/** What `SourceBoot` asks of the record: the last good build of a source, how long one took, and a place to say what happens. */
export interface ISourceMemory {
  lastGood: (opts: { source: IAtlasSource }) => IResolvedSource | undefined;
  expectedMs: (opts: { source: IAtlasSource }) => number | undefined;
  record: (opts: { source: IAtlasSource; entry: ISourceRecord }) => void;
}

export class FileSourceMemory implements ISourceMemory {
  private readonly file: string;

  constructor(opts: { cacheBase: string }) {
    this.file = SourceStatus.fileOf(opts);
  }

  /**
   * The last good resolution of the source, when it is still the one the config declares and its files are still on disk
   * (the checkout, the index and the release table); `undefined` otherwise.
   */
  lastGood(opts: { source: IAtlasSource }): IResolvedSource | undefined {
    const resolved = SourceStatus.read({ file: this.file })[opts.source.name]?.resolved;
    const declared = resolved?.declared;

    if (
      resolved === undefined ||
      declared === undefined ||
      declared.repo !== opts.source.repo ||
      declared.ref !== opts.source.ref ||
      declared.pin !== opts.source.pin
    ) {
      return undefined;
    }

    return [resolved.root, resolved.indexFile, resolved.releasesFile].every(
      (path) => path === undefined || existsSync(path),
    ) && resolved.indexFile !== undefined
      ? resolved
      : undefined;
  }

  expectedMs(opts: { source: IAtlasSource }): number | undefined {
    return SourceStatus.read({ file: this.file })[opts.source.name]?.durationMs;
  }

  record(opts: { source: IAtlasSource; entry: ISourceRecord }): void {
    const kept = SourceStatus.read({ file: this.file })[opts.source.name];

    // A build that is running or has failed keeps the last good resolution and duration: they are what the next start serves.
    SourceStatus.record({
      file: this.file,
      name: opts.source.name,
      entry: {
        ...(kept?.resolved === undefined ? {} : { resolved: kept.resolved }),
        ...(kept?.durationMs === undefined ? {} : { durationMs: kept.durationMs }),
        ...opts.entry,
      },
    });
  }
}
