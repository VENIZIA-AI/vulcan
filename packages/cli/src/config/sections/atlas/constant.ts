/** The bounds and the transports of the atlas section. */
export class AtlasSectionConstants {
  /** The bounds of `atlas.limits.download`: the ones atlas reads the value within; outside them it keeps its default. */
  static readonly MIN_DOWNLOAD_BYTES = 1024 * 1024;
  static readonly MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
  /** A source repository atlas will not give to git: an `http://` or `git://` URL (clear text), or a `scheme::` remote helper (it runs a command). */
  static readonly SOURCE_TRANSPORT = /^(?:(http|git):\/\/|[a-z][a-z0-9+.-]*::)/i;
}
