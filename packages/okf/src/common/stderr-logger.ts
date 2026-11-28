import { ConstClass } from './types.ts';
import type { TConstValue } from './types.ts';

/** The levels a log line carries; `emerg` is never a configured threshold. */
export class LogLevels extends ConstClass {
  static readonly DEBUG = 'debug';
  static readonly INFO = 'info';
  static readonly WARN = 'warn';
  static readonly ERROR = 'error';
  static readonly EMERG = 'emerg';
}

/** One of the levels of `LogLevels`. */
export type TLogLevel = TConstValue<typeof LogLevels>;

/** A scoped logger; `for` narrows the scope to one method. Every line goes to stderr. */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  emerg(message: string, ...args: unknown[]): void;
  log(level: TLogLevel, message: string, ...args: unknown[]): void;
  for(methodName: string): ILogger;
}

const LEVEL_RANK: Record<TLogLevel, number> = {
  [LogLevels.DEBUG]: 0,
  [LogLevels.INFO]: 1,
  [LogLevels.WARN]: 2,
  [LogLevels.ERROR]: 3,
  [LogLevels.EMERG]: 4,
};

/** The only values `APP_ENV_LOGGER_LEVEL` may set the threshold to - `emerg` is never a configured floor. */
const CONFIGURABLE_LEVEL_BY_NAME: Record<string, TLogLevel> = {
  [LogLevels.DEBUG]: LogLevels.DEBUG,
  [LogLevels.INFO]: LogLevels.INFO,
  [LogLevels.WARN]: LogLevels.WARN,
  [LogLevels.ERROR]: LogLevels.ERROR,
};

const DEFAULT_LEVEL: TLogLevel = LogLevels.INFO;

/** `APP_ENV_LOGGER_LEVEL` if it names a configurable level, else the default - read once per logger instance. */
const resolveThreshold = (): TLogLevel => {
  const configured = (process.env.APP_ENV_LOGGER_LEVEL ?? '').trim().toLowerCase();

  return CONFIGURABLE_LEVEL_BY_NAME[configured] ?? DEFAULT_LEVEL;
};

/**
 * The one writer of notes to stderr, shared by the VULCAN packages: stdout carries only what a command prints.
 * `note` always writes; a scoped logger (`get`) writes a line at or above the threshold of `APP_ENV_LOGGER_LEVEL`.
 */
export class StderrLogger implements ILogger {
  private static readonly cache = new Map<string, StderrLogger>();
  private readonly prefix: string;
  private readonly threshold: TLogLevel;

  private constructor(private readonly scope: string) {
    this.prefix = scope !== '' ? `[${scope}] ` : '';
    this.threshold = resolveThreshold();
  }

  /** Writes a note to stderr, whatever the threshold. */
  static note(message: string, ...args: unknown[]): void {
    console.error(message, ...args);
  }

  static get(scope: string): ILogger {
    const cached = this.cache.get(scope);

    if (cached) {
      return cached;
    }

    const created = new StderrLogger(scope);

    this.cache.set(scope, created);

    return created;
  }

  private write(opts: { level: TLogLevel; message: string; args: unknown[] }): void {
    if (LEVEL_RANK[opts.level] < LEVEL_RANK[this.threshold]) {
      return;
    }

    StderrLogger.note(`${this.prefix}${opts.message}`, ...opts.args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.write({ level: LogLevels.DEBUG, message, args });
  }

  info(message: string, ...args: unknown[]): void {
    this.write({ level: LogLevels.INFO, message, args });
  }

  warn(message: string, ...args: unknown[]): void {
    this.write({ level: LogLevels.WARN, message, args });
  }

  error(message: string, ...args: unknown[]): void {
    this.write({ level: LogLevels.ERROR, message, args });
  }

  emerg(message: string, ...args: unknown[]): void {
    this.write({ level: LogLevels.EMERG, message, args });
  }

  log(level: TLogLevel, message: string, ...args: unknown[]): void {
    this.write({ level, message, args });
  }

  for(methodName: string): ILogger {
    const childScope = this.scope !== '' ? `${this.scope}-${methodName}` : methodName;

    return StderrLogger.get(childScope);
  }
}
