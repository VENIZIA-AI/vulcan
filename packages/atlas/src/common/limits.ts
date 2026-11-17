const MIB = 1024 * 1024;

/** The sizes atlas lets a network body reach before it stops reading. */
export class AtlasLimits {
  /** The default for a tarball: `atlas.limits.download` of the project. */
  static readonly DEFAULT_DOWNLOAD_BYTES = 128 * MIB;
  /** The bounds `atlas.limits.download` may be set within: a value outside them is ignored. */
  static readonly MIN_DOWNLOAD_BYTES = MIB;
  static readonly MAX_DOWNLOAD_BYTES = 1024 * MIB;
  /** The ref advertisement of a remote: text of ref names, no setting. */
  static readonly ADVERTISEMENT_BYTES = 16 * MIB;

  private static download = AtlasLimits.DEFAULT_DOWNLOAD_BYTES;

  /** The project's `atlas.limits.download`, once at the start; anything but an integer in the bounds keeps the default. */
  static configure(opts: { download?: number }): void {
    AtlasLimits.download =
      AtlasLimits.validDownloadOf({ value: opts.download }) ?? AtlasLimits.DEFAULT_DOWNLOAD_BYTES;
  }

  /** The value when it is an integer within the bounds; `undefined` otherwise. */
  static validDownloadOf(opts: { value: unknown }): number | undefined {
    const { value } = opts;

    return typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= AtlasLimits.MIN_DOWNLOAD_BYTES &&
      value <= AtlasLimits.MAX_DOWNLOAD_BYTES
      ? value
      : undefined;
  }

  static downloadBytes(): number {
    return AtlasLimits.download;
  }
}

/** A response body read up to a size. */
export class BoundedBody {
  /**
   * The body, or `undefined` when it is over `cap`: refused at once when the response announces a larger length,
   * else cut off while it is read - nothing past `cap` is held, and nothing is kept of a body that is over.
   */
  static async read(opts: { response: Response; cap: number }): Promise<Uint8Array | undefined> {
    const announced = Number(opts.response.headers.get('content-length'));

    if (Number.isFinite(announced) && announced > opts.cap) {
      await opts.response.body?.cancel();

      return undefined;
    }

    const reader = opts.response.body?.getReader();

    if (reader === undefined) {
      return new Uint8Array();
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > opts.cap) {
        await reader.cancel();

        return undefined;
      }

      chunks.push(value);
    }

    const body = new Uint8Array(total);
    let at = 0;

    for (const chunk of chunks) {
      body.set(chunk, at);
      at += chunk.byteLength;
    }

    return body;
  }
}
