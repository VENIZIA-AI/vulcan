// --- managed regions ---

export class ManagedRegion {
  static markers(opts: { id: string }): { start: string; end: string } {
    return {
      start: `<!-- okf:generated:${opts.id} start -->`,
      end: `<!-- okf:generated:${opts.id} end -->`,
    };
  }

  static replace(opts: { text: string; id: string; file: string; body: string }): string {
    const { text, id, file, body } = opts;

    const { start, startAt, endAt } = ManagedRegion.locate({ text, id, file });

    return text.slice(0, startAt + start.length) + '\n' + body + '\n' + text.slice(endAt);
  }

  /** The region's current body; throws like `locate` when its markers are broken. */
  static extract(opts: { text: string; id: string; file: string }): string {
    const { start, startAt, endAt } = ManagedRegion.locate(opts);

    return opts.text.slice(startAt + start.length, endAt).trim();
  }

  /**
   * Locate a managed region, rejecting malformed or duplicated markers rather than corrupting the file.
   * `file` is the host file as the person sees it, named in every error.
   */
  private static locate(opts: { text: string; id: string; file: string }): {
    start: string;
    end: string;
    startAt: number;
    endAt: number;
  } {
    const { text, id, file } = opts;

    const { start, end } = ManagedRegion.markers({ id });
    const startAt = text.indexOf(start);
    const endAt = text.indexOf(end);
    const region = `okf: ${file}: managed region '${id}'`;

    if (startAt === -1 || endAt === -1) {
      throw new Error(`${region} is missing its markers - add ${start} and ${end}`);
    }

    if (text.indexOf(start, startAt + 1) !== -1) {
      throw new Error(`${region} is malformed - a duplicate start marker`);
    }

    if (text.indexOf(end, endAt + 1) !== -1) {
      throw new Error(`${region} is malformed - a duplicate end marker`);
    }

    if (startAt + start.length > endAt) {
      throw new Error(`${region} is malformed - the end marker precedes the start marker`);
    }

    return { start, end, startAt, endAt };
  }
}
