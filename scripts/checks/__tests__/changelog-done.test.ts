import { describe, expect, test } from 'bun:test';
import {
  doneKey,
  readDone,
  writeDone,
} from '../../../docs/wiki/site/.vitepress/theme/shared/changelog-done.ts';

const memory = (): Storage => {
  const map = new Map<string, string>();

  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
};

const throwing = (): Storage => {
  const fail = (): never => {
    throw new Error('storage is blocked');
  };

  return {
    get length(): number {
      return fail();
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
};

describe('the steps a reader has done', () => {
  test("are kept per version in the reader's storage and read back as a set", () => {
    const storage = memory();

    writeDone({ storage, version: '0.4.8', ids: new Set(['a', 'b']) });
    writeDone({ storage, version: '0.4.7', ids: new Set(['z']) });

    expect(readDone({ storage, version: '0.4.8' })).toEqual(new Set(['a', 'b']));
    expect(readDone({ storage, version: '0.4.7' })).toEqual(new Set(['z']));
    expect(storage.getItem(doneKey({ version: '0.4.8' }))).toBe('["a","b"]');
  });

  test('read nothing when there is no storage, it is blocked, or it holds something else', () => {
    expect(readDone({ storage: undefined, version: '0.4.8' })).toEqual(new Set());
    expect(readDone({ storage: throwing(), version: '0.4.8' })).toEqual(new Set());

    const storage = memory();

    storage.setItem(doneKey({ version: '0.4.8' }), '{"not":"a list"}');
    expect(readDone({ storage, version: '0.4.8' })).toEqual(new Set());
    storage.setItem(doneKey({ version: '0.4.8' }), 'not json');
    expect(readDone({ storage, version: '0.4.8' })).toEqual(new Set());
    storage.setItem(doneKey({ version: '0.4.8' }), '["a", 3, null]');
    expect(readDone({ storage, version: '0.4.8' })).toEqual(new Set(['a']));
  });

  test('writing never throws: a blocked storage keeps nothing and the page goes on', () => {
    expect(() =>
      writeDone({ storage: throwing(), version: '0.4.8', ids: new Set(['a']) }),
    ).not.toThrow();
    expect(() =>
      writeDone({ storage: undefined, version: '0.4.8', ids: new Set(['a']) }),
    ).not.toThrow();
  });
});
