/** Characters that never belong in an address a terminal will print: controls, whitespace, soft hyphen, zero-width and bidirectional marks. */
const UNPRINTABLE =
  // eslint-disable-next-line no-control-regex -- the control range is what this refuses
  /[\u0000-\u0020\u007f-\u00a0\u00ad\u200b-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;
const NOT_ASCII_PRINTABLE = /[^\u0021-\u007e]/g;

/** The address of a project's wiki (`knowledge.siteUrl`): a link base the plan prints, so it is a plain web address or nothing. */
export class SiteUrl {
  private static isLoopback(opts: { hostname: string }): boolean {
    return (
      opts.hostname === 'localhost' ||
      opts.hostname.endsWith('.localhost') ||
      opts.hostname === '127.0.0.1' ||
      opts.hostname === '[::1]'
    );
  }

  /** `value` for a message: every character outside printable ASCII shown as its escape, never itself. */
  private static shown(opts: { value: string }): string {
    const escaped = opts.value
      .replace(/[\\"]/g, (char) => `\\${char}`)
      .replace(
        NOT_ASCII_PRINTABLE,
        (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
      );

    return `"${escaped}"`;
  }

  /**
   * The address as a base without its trailing slash, or why it is refused: `https`, or `http` on a loopback host
   * only; no credentials, query or fragment; no whitespace, control or bidirectional character. A manifest fetched
   * from another repository is data, and this is what makes it safe to print.
   */
  static parse(opts: { value: string }): { href: string } | { problem: string } {
    const refuse = (reason: string): { problem: string } => ({
      problem: `${SiteUrl.shown({ value: opts.value })} is not a usable address: ${reason}`,
    });

    if (UNPRINTABLE.test(opts.value)) {
      return refuse('it holds a space, control or bidirectional character');
    }

    if (/[?#]/.test(opts.value)) {
      return refuse('it must have no query or fragment');
    }

    let url: URL;

    try {
      url = new URL(opts.value);
    } catch {
      return refuse('it does not parse as an address');
    }

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && SiteUrl.isLoopback(url))) {
      return refuse('it must be https (http only for localhost)');
    }

    if (url.username !== '' || url.password !== '') {
      return refuse('it must hold no credentials');
    }

    return { href: url.href.replace(/\/+$/, '') };
  }
}
