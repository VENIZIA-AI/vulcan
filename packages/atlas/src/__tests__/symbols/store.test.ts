import { IGNIS_PACKAGE_MAP } from '../fixtures/ignis-packages';
import { SymbolStore } from '@/symbols';
import type { ISymbolRecord } from '@/symbols';
import { describe, expect, spyOn, test } from 'bun:test';

const record = (opts: Partial<ISymbolRecord> & { name: string }): ISymbolRecord => ({
  package: '@venizia/ignis-helpers',
  subpath: '.',
  specifier: '@venizia/ignis-helpers',
  kind: 'function',
  file: 'packages/helpers/src/modules/error/error.ts',
  line: 42,
  signature: `${opts.name}(): void`,
  ...opts,
});

const SYMBOLS: ISymbolRecord[] = [
  record({ name: 'getError' }),
  record({ name: 'respond', package: '@venizia/ignis', specifier: '@venizia/ignis' }),
  record({ name: 'respond', package: '@venizia/ignis-kernel', specifier: '@venizia/ignis-kernel' }),
  record({ name: 'respondError' }),
  record({ name: 'BaseHelper', kind: 'class' }),
];

const buildStore = (): SymbolStore =>
  new SymbolStore({ symbols: SYMBOLS, packageMap: IGNIS_PACKAGE_MAP });

describe('SymbolStore.lookup', () => {
  test('returns the one record an exact name names', () => {
    const found = buildStore().lookup({ name: 'getError' });

    expect(found).toHaveLength(1);
    expect(found[0].signature).toBe('getError(): void');
  });

  test('returns every record when one name exists in two packages', () => {
    const found = buildStore().lookup({ name: 'respond' });

    expect(found.map(entry => entry.package).sort()).toEqual([
      '@venizia/ignis',
      '@venizia/ignis-kernel',
    ]);
  });

  test('filters by the short package name', () => {
    const found = buildStore().lookup({ name: 'respond', package: 'kernel' });

    expect(found).toHaveLength(1);
    expect(found[0].package).toBe('@venizia/ignis-kernel');
  });

  test('filters by the full npm package name', () => {
    const found = buildStore().lookup({ name: 'respond', package: '@venizia/ignis-kernel' });

    expect(found).toHaveLength(1);
    expect(found[0].package).toBe('@venizia/ignis-kernel');
  });

  test('returns nothing for an unknown name', () => {
    expect(buildStore().lookup({ name: 'nowhere' })).toEqual([]);
  });

  test('is case sensitive - a wrong case is not an exact hit', () => {
    expect(buildStore().lookup({ name: 'geterror' })).toEqual([]);
  });
});

describe('SymbolStore.suggest', () => {
  test('names the close candidate of a typo', () => {
    expect(buildStore().suggest({ name: 'respnd' })).toEqual(['respond']);
  });

  test('offers a substring match no prefix match covers', () => {
    expect(buildStore().suggest({ name: 'Error' })).toContain('respondError');
  });

  test('offers a case-insensitive prefix match before anything else', () => {
    expect(buildStore().suggest({ name: 'geterr' })[0]).toBe('getError');
  });

  test('never returns more than the limit', () => {
    expect(buildStore().suggest({ name: 'resp', limit: 1 })).toHaveLength(1);
  });

  test('returns nothing when no known name is close', () => {
    expect(buildStore().suggest({ name: 'zzzzzzzzzzz' })).toEqual([]);
  });
});

describe('SymbolStore with no table', () => {
  const empty = new SymbolStore({ symbols: [] });

  test('reports itself empty', () => {
    expect(empty.isEmpty()).toBe(true);
  });

  test('looks up nothing and suggests nothing', () => {
    expect(empty.lookup({ name: 'getError' })).toEqual([]);
    expect(empty.suggest({ name: 'getError' })).toEqual([]);
  });
});

describe('SymbolStore package names from the table', () => {
  const PACKAGE_MAP = [
    { dir: 'helpers', name: '@venizia/ignis-helpers', aliases: [] },
    { dir: 'core-server', name: '@venizia/ignis', aliases: ['core'] },
  ];

  test('a directory or an alias answers through the package map', () => {
    const store = new SymbolStore({ symbols: SYMBOLS, packageMap: PACKAGE_MAP });

    expect(store.lookup({ name: 'getError', package: 'helpers' })).toHaveLength(1);
    expect(store.lookup({ name: 'respond', package: 'core' })[0].package).toBe('@venizia/ignis');
  });

  test('a table without a package map still answers the exact npm name', () => {
    const store = new SymbolStore({ symbols: SYMBOLS });

    expect(store.lookup({ name: 'getError', package: '@venizia/ignis-helpers' })).toHaveLength(1);
    expect(store.lookup({ name: 'respond', package: 'core' })).toEqual([]);
  });
});

describe('SymbolStore, deferred (D2)', () => {
  test('loads on the first question, once - a server starts without reading any declarations', () => {
    let loads = 0;
    const store = new SymbolStore({
      load: () => {
        loads += 1;

        return { symbols: SYMBOLS, packageMap: IGNIS_PACKAGE_MAP };
      },
    });

    expect(loads).toBe(0);
    expect(store.lookup({ name: 'getError', package: 'helpers' })).toHaveLength(1);
    expect(store.suggest({ name: 'getErr' })).toContain('getError');
    expect(loads).toBe(1);
  });

  test('an empty store says why, in the words its owner gave', () => {
    const store = new SymbolStore({
      load: () => ({ symbols: [] }),
      emptyReason: 'no symbols - build the packages first',
    });

    expect(store.isEmpty()).toBe(true);
    expect(store.emptyReason).toBe('no symbols - build the packages first');
  });
});

describe('SymbolStore, while its loader fails', () => {
  test('logs each distinct error once and keeps loading on every question', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
    let loads = 0;
    const store = new SymbolStore({
      load: () => {
        loads += 1;

        throw new Error(loads < 4 ? 'no dist yet' : 'a broken declaration');
      },
    });

    try {
      for (const name of ['a', 'b', 'c', 'd', 'e']) {
        store.lookup({ name });
      }

      const logged = errorSpy.mock.calls.map(call => String(call[1]));

      // Must run before `mockRestore()`: restoring a spy also clears its recorded calls.
      expect(loads).toBe(5);
      expect(logged).toHaveLength(2);
      expect(logged[0]).toContain('no dist yet');
      expect(logged[1]).toContain('a broken declaration');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
