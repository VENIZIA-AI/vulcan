import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { StderrLogger } from '@venizia/vulcan-okf';
import { SourceCache } from '@/sources/cache';
import { PinPolicy } from '@/sources/pin';
import { SourcePins } from '@/common/constants';
import { InstalledPackages } from '@/sources/installed';
import { SourceResolver } from '@/sources/resolver';
import type { IAtlasSource, IResolvedSource } from '@/sources/common';
import type { TConstValue } from '@/common/types';

/** The state of one source in the record. */
export class SourceRecordStates {
  static readonly BUILDING = 'building';
  static readonly READY = 'ready';
  static readonly FAILED = 'failed';
}

/** What a warning about one source of the record says. */
export class SourceProblemTypes {
  static readonly FAILED = 'failed';
  static readonly REFRESH_FAILED = 'refresh-failed';
  static readonly HUNG = 'hung';
  static readonly ABANDONED = 'abandoned';
}

export type TSourceRecordState = TConstValue<typeof SourceRecordStates>;
export type TSourceProblemType = TConstValue<typeof SourceProblemTypes>;

/** What the last server run recorded about one source. */
export interface ISourceRecord {
  /** `building` while a child indexes it, `ready` once it is served, `failed` with the reason. */
  state: TSourceRecordState;
  /** When the state began, milliseconds since the epoch. */
  since: number;
  /** The server process that began the build: a `building` record whose process is gone was left by a closed session. */
  pid?: number;
  /** How long the last successful build took; the next one is expected to take about as long. */
  durationMs?: number;
  /** The last error line of a failed build. */
  error?: string;
  /** The source as the last good build resolved it: a server that starts answers from it at once. */
  resolved?: IResolvedSource;
}

/** One thing worth a warning in the record, decided from the record and never from its text. */
export interface ISourceProblem {
  source: string;
  /** `failed`: never served; `refresh-failed`: served from an older index, the last check failed; `hung`: building too long by a live server; `abandoned`: building, but the server that began it is gone. */
  type: TSourceProblemType;
  detail: string;
}

interface IStatusFile {
  version: 1;
  sources: Record<string, ISourceRecord>;
}

const VERSION = 1;
const FILE_NAME = 'status.json';
/** A source still building after this long by a server that is alive has most likely hung. */
export const STUCK_MS = 10 * 60 * 1000;

const isAlive = (opts: { pid: number }): boolean => {
  try {
    process.kill(opts.pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

/**
 * What a server remembers about its sources between starts, in one small file beside the cache (`atlas/status.json`),
 * so a server that starts can answer from the last good index while it checks the remote again, and `vulcan atlas
 * status` and `vulcan project doctor` can say what happened. A file that is missing, unreadable or of another version reads as
 * empty: it is a hint, never a source of truth, and it never stops a start. What cannot be read or written is logged.
 */
export class SourceStatus {
  /** Where a server that was given `--cache-dir` says its cache is, so `status` and `doctor` look there. */
  static pointerOf(opts: { root: string }): string {
    return join(opts.root, '.agents', 'local', 'atlas-cache-base');
  }

  /** Remembers a custom cache base (or forgets it, when the default is used). */
  static remember(opts: { root: string; cacheBase: string; isCustom: boolean }): void {
    const pointer = SourceStatus.pointerOf(opts);

    try {
      if (opts.isCustom) {
        mkdirSync(dirname(pointer), { recursive: true });
        writeFileSync(pointer, `${opts.cacheBase}\n`);
      } else {
        rmSync(pointer, { force: true });
      }
    } catch (error) {
      StderrLogger.get('SourceStatus').warn(
        'the cache folder could not be remembered | file: %s | error: %s',
        pointer,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** The cache base a project's atlas uses: the one asked for, else the one a server remembered, else the default. */
  static cacheBaseOf(opts: { root: string; cacheDir?: string }): string {
    const remembered = existsSync(SourceStatus.pointerOf(opts))
      ? readFileSync(SourceStatus.pointerOf(opts), 'utf8').trim()
      : undefined;

    return SourceCache.cacheBaseOf({
      cwd: opts.root,
      cacheDir: opts.cacheDir ?? (remembered === '' ? undefined : remembered),
    });
  }

  /** `<cacheBase>/atlas/status.json`. */
  static fileOf(opts: { cacheBase: string }): string {
    return join(opts.cacheBase, 'atlas', FILE_NAME);
  }

  static read(opts: { file: string }): Record<string, ISourceRecord> {
    if (!existsSync(opts.file)) {
      return {};
    }

    try {
      const parsed: IStatusFile = JSON.parse(readFileSync(opts.file, 'utf8'));

      return parsed.version === VERSION && typeof parsed.sources === 'object' ? parsed.sources : {};
    } catch (error) {
      StderrLogger.get('SourceStatus').warn(
        'the record of the sources cannot be read, it is ignored | file: %s | error: %s',
        opts.file,
        error instanceof Error ? error.message : String(error),
      );

      return {};
    }
  }

  private static write(opts: { file: string; sources: Record<string, ISourceRecord> }): void {
    const temporary = `${opts.file}.${process.pid}.tmp`;

    try {
      mkdirSync(dirname(opts.file), { recursive: true });
      writeFileSync(
        temporary,
        `${JSON.stringify({ version: VERSION, sources: opts.sources }, null, 2)}\n`,
      );
      renameSync(temporary, opts.file);
    } catch (error) {
      rmSync(temporary, { force: true });
      StderrLogger.get('SourceStatus').warn(
        'the record of the sources cannot be written | file: %s | error: %s',
        opts.file,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Writes one source's record: read again, changed, written to a temporary file and renamed, so a reader never sees half of it. */
  static record(opts: { file: string; name: string; entry: ISourceRecord }): void {
    SourceStatus.write({
      file: opts.file,
      sources: { ...SourceStatus.read({ file: opts.file }), [opts.name]: opts.entry },
    });
  }

  /** Drops the records of sources the config no longer declares, and the temporary files a killed server left. */
  static prune(opts: { file: string; keep: string[] }): void {
    const sources = SourceStatus.read({ file: opts.file });
    const stale = Object.keys(sources).filter((name) => !opts.keep.includes(name));

    if (stale.length > 0) {
      SourceStatus.write({
        file: opts.file,
        sources: Object.fromEntries(
          Object.entries(sources).filter(([name]) => opts.keep.includes(name)),
        ),
      });
    }

    const directory = dirname(opts.file);

    if (existsSync(directory)) {
      for (const name of readdirSync(directory)) {
        if (name.startsWith(`${FILE_NAME}.`) && name.endsWith('.tmp')) {
          rmSync(join(directory, name), { force: true });
        }
      }
    }
  }

  /** The things in the record worth a warning, for the sources `declared` names. */
  static problemsOf(opts: {
    records: Record<string, ISourceRecord>;
    declared: string[];
    now: number;
    alive?: (opts: { pid: number }) => boolean;
  }): ISourceProblem[] {
    const alive = opts.alive ?? isAlive;

    return opts.declared.flatMap((name): ISourceProblem[] => {
      const entry = opts.records[name];

      if (entry === undefined) {
        return [];
      }

      if (entry.state === 'failed') {
        return [
          {
            source: name,
            type: entry.resolved === undefined ? 'failed' : 'refresh-failed',
            detail: entry.error ?? 'no reason recorded',
          },
        ];
      }

      if (entry.state === 'building' && opts.now - entry.since > STUCK_MS) {
        return [
          entry.pid !== undefined && alive({ pid: entry.pid })
            ? { source: name, type: 'hung', detail: 'building for over 10 minutes' }
            : {
                source: name,
                type: 'abandoned',
                detail: 'its server is gone; the next start builds it again',
              },
        ];
      }

      return [];
    });
  }
}

/** What `SourceBoot` asks of the record: the last good build of a source, how long one took, and a place to say what happens. */
export interface ISourceMemory {
  lastGood: (opts: { source: IAtlasSource }) => IResolvedSource | undefined;
  expectedMs: (opts: { source: IAtlasSource }) => number | undefined;
  record: (opts: { source: IAtlasSource; entry: ISourceRecord }) => void;
  /** Forgets the sources the config no longer declares. */
  prune: (opts: { keep: string[] }) => void;
}

export class FileSourceMemory implements ISourceMemory {
  private readonly file: string;
  private readonly cwd: string;
  private readonly cacheBase: string;
  private readonly isStaleAllowed: boolean;

  /**
   * `isStaleAllowed: false` is for a command that needs the fresh build (`migrate`, `tools`): it records what it does
   * but never answers from an older index.
   */
  constructor(opts: { cwd: string; cacheBase: string; isStaleAllowed?: boolean }) {
    this.file = SourceStatus.fileOf(opts);
    this.cwd = opts.cwd;
    this.cacheBase = opts.cacheBase;
    this.isStaleAllowed = opts.isStaleAllowed ?? true;
  }

  /**
   * The last good resolution of the source, when it is still what a fresh start would serve: the declared source is the
   * same, its set is complete and of this atlas's index format, its files are on disk, and, for a docs pin that follows the
   * installed version, the installed packages still decide the same tag. `undefined` otherwise: the build runs from nothing.
   */
  lastGood(opts: { source: IAtlasSource }): IResolvedSource | undefined {
    if (!this.isStaleAllowed) {
      return undefined;
    }

    const resolved = SourceStatus.read({ file: this.file })[opts.source.name]?.resolved;
    const declared = resolved?.declared;

    if (
      resolved === undefined ||
      declared === undefined ||
      declared.repo !== opts.source.repo ||
      declared.ref !== opts.source.ref ||
      declared.pin !== opts.source.pin ||
      resolved.sha === undefined ||
      resolved.indexFile === undefined ||
      resolved.releasesFile === undefined ||
      !existsSync(resolved.root) ||
      !SourceResolver.isCached({
        source: opts.source,
        cacheBase: this.cacheBase,
        sha: resolved.sha,
      }) ||
      !existsSync(resolved.indexFile) ||
      !existsSync(resolved.releasesFile)
    ) {
      return undefined;
    }

    return this.isPinCurrent({ source: opts.source, resolved }) ? resolved : undefined;
  }

  private isPinCurrent(opts: { source: IAtlasSource; resolved: IResolvedSource }): boolean {
    if (opts.source.pin === SourcePins.REF) {
      return true;
    }

    try {
      const decision = PinPolicy.decide({
        roots: InstalledPackages.installRootsOf({ cwd: this.cwd }),
        project: opts.resolved.refProject ?? opts.resolved.project,
        table: JSON.parse(readFileSync(opts.resolved.releasesFile ?? '', 'utf8')),
      });

      return decision.pinned
        ? opts.resolved.pin?.pinned === true && opts.resolved.pin.ref === decision.tag
        : opts.resolved.pin?.pinned !== true;
    } catch (error) {
      StderrLogger.get('FileSourceMemory').warn(
        'the docs pin could not be checked, the last good index is not served | source: %s | error: %s',
        opts.source.name,
        error instanceof Error ? error.message : String(error),
      );

      return false;
    }
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

  prune(opts: { keep: string[] }): void {
    SourceStatus.prune({ file: this.file, keep: opts.keep });
  }
}
