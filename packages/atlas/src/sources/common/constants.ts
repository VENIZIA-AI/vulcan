import { ConstClass } from '../../common/types';

/** How a source was reached this start: the working repository, the cache, a fresh pull, or the cache when offline. */
export class SourceModes extends ConstClass {
  static readonly REPOSITORY = 'repository';
  static readonly CACHE = 'cache';
  static readonly FRESH = 'fresh';
  static readonly OFFLINE_CACHE = 'offline-cache';
}
