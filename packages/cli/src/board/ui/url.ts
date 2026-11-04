/** The only way an address from data gets into a link or a source: Preact, unlike React 19, lets a `javascript:` address through. */
export class BoardUrl {
  /** The address when it is `https://`, or, for an image, a `data:image/` one; otherwise nothing. */
  static safe(opts: { value: string | undefined; image?: boolean }): string | undefined {
    const { value } = opts;

    if (value === undefined) {
      return undefined;
    }

    return /^https:\/\//.test(value) || (opts.image === true && /^data:image\//.test(value))
      ? value
      : undefined;
  }
}
