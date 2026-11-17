import { BrowserSocket } from '../../local/index.ts';

/**
 * A test project lives under the test temp folder, which sits inside the checkout and is deep, so the
 * browser socket warning is on in most of them. A test that counts or lists warnings drops it here and
 * leaves its own check to `browser-socket.test.ts`.
 */
export class SocketWarning {
  static without<T extends { message: string }>(opts: { warnings: T[] }): T[] {
    return opts.warnings.filter((warning) => !warning.message.includes(BrowserSocket.ERROR));
  }
}
