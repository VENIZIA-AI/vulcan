/** The only way an address from data gets into a link or a source: Preact, unlike React 19, lets a `javascript:` address through. A link may be `http://` (a self-hosted GitLab); an image may not. */
export class BoardUrl {
  /** The address when it is `https://` (or `http://` for a link), or, for an image, a `data:image/` one; otherwise nothing. */
  static safe(opts: { value: string | undefined; image?: boolean }): string | undefined {
    const { value } = opts;

    if (value === undefined) {
      return undefined;
    }

    if (opts.image === true) {
      return /^(?:https:\/\/|data:image\/)/.test(value) ? value : undefined;
    }

    return /^https?:\/\//.test(value) ? value : undefined;
  }
}
