import { FallbackUtility } from '../../../common/utilities/fallback.utility.ts';

/** What the page keeps in the browser, under one prefix per board. A browser that refuses storage just forgets. */
export class BoardStorage {
  static get(opts: { key: string }): string | null {
    return FallbackUtility.of({
      read: () => localStorage.getItem(opts.key),
      otherwise: null,
    });
  }

  static set(opts: { key: string; value: string }): void {
    FallbackUtility.attempt({
      run: () => {
        localStorage.setItem(opts.key, opts.value);
      },
    });
  }

  static remove(opts: { key: string }): void {
    FallbackUtility.attempt({
      run: () => {
        localStorage.removeItem(opts.key);
      },
    });
  }
}
