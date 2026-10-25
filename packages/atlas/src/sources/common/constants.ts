/** How a source was reached this start: the working repository, the cache, a fresh pull, or the cache when offline. */
export class SourceModes {
  static readonly REPOSITORY = 'repository';
  static readonly CACHE = 'cache';
  static readonly FRESH = 'fresh';
  static readonly OFFLINE_CACHE = 'offline-cache';

  static readonly SCHEME_SET = new Set<string>([
    this.REPOSITORY,
    this.CACHE,
    this.FRESH,
    this.OFFLINE_CACHE,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}
