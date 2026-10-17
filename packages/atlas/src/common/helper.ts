import { StderrLogger } from './logger';
import type { ILogger } from './types';

/** A class that logs under its own scope, `[Scope-method] message`, to stderr. */
export abstract class BaseHelper {
  protected readonly logger: ILogger;

  constructor(opts: { scope: string }) {
    this.logger = StderrLogger.get(opts.scope);
  }
}
