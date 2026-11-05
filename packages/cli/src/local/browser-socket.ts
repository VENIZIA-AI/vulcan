import { join } from 'node:path';

/**
 * Chrome and Chromium put a unix socket at `<temp folder>/<profile folder>/SingletonSocket` and exit with "Socket path too long"
 * when it passes the limit of a unix socket path. The tests and `vulcan doctor` read this one place.
 */
export class BrowserSocket {
  /** A unix socket path is 107 characters at most on Linux. */
  static readonly PATH_MAX = 107;

  /** What a browser prints when the socket path is over the limit. */
  static readonly ERROR = 'Socket path too long';

  /** What each browser adds below its temp folder; the profile folder is a name and six random characters. */
  static readonly NAMES = [
    join('com.google.Chrome.XXXXXX', 'SingletonSocket'),
    join('org.chromium.Chromium.XXXXXX', 'SingletonSocket'),
  ];

  /** The longest of `NAMES`: a folder that holds it holds every browser's socket. */
  static longest(): string {
    return BrowserSocket.NAMES.reduce((a, b) => (b.length > a.length ? b : a));
  }

  /** The length of the longest socket path a browser would make in `folder`. */
  static lengthOf(opts: { folder: string }): number {
    return join(opts.folder, BrowserSocket.longest()).length;
  }

  static fits(opts: { folder: string }): boolean {
    return BrowserSocket.lengthOf(opts) <= BrowserSocket.PATH_MAX;
  }
}
