import { ConstClass } from '../../common/types';

/** How a source was reached this start: the working repository, the cache, a fresh pull, or the cache when offline. */
export class SourceModes extends ConstClass {
  static readonly REPOSITORY = 'repository';
  static readonly CACHE = 'cache';
  static readonly FRESH = 'fresh';
  static readonly OFFLINE_CACHE = 'offline-cache';
}

/** The files of a cached SHA's artifacts set. */
export class SourceSetFiles {
  static readonly COMPLETE = 'complete';
  static readonly INDEX = 'index.sqlite';
  static readonly RELEASES = 'releases.json';
  /** The `INDEX_FORMAT` the set was built at; a set of another format is rebuilt, never read as current. */
  static readonly FORMAT = 'format';
  /** Present when the index came from a prebuilt pair: names the atlas version that built it. */
  static readonly PREBUILT = 'prebuilt';
  /** Written by a pull through git: the release table carries the history the tags give. */
  static readonly HISTORY = 'history';
  /** The fingerprint of the remote's tags the release table was computed from. */
  static readonly TAGS = 'tags';
}
