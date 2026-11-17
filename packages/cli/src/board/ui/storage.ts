/** What the page keeps in the browser, under one prefix per board. A browser that refuses storage just forgets. */
export class BoardStorage {
  static get(opts: { key: string }): string | null {
    try {
      return localStorage.getItem(opts.key);
    } catch {
      return null;
    }
  }

  static set(opts: { key: string; value: string }): void {
    try {
      localStorage.setItem(opts.key, opts.value);
    } catch {
      // Storage is off: the choice lasts until the page closes.
    }
  }

  static remove(opts: { key: string }): void {
    try {
      localStorage.removeItem(opts.key);
    } catch {
      // Nothing was kept.
    }
  }
}
