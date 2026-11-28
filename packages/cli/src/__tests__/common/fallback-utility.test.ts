import { describe, expect, test } from 'bun:test';
import { FallbackUtility } from '../../common/utilities/fallback.utility.ts';

const throwing = (): never => {
  throw new Error('unreadable');
};

describe('FallbackUtility', () => {
  test('of answers what read returns, a falsy value included', () => {
    expect(FallbackUtility.of({ read: () => 'value', otherwise: undefined })).toBe('value');
    expect(FallbackUtility.of({ read: () => 0, otherwise: 1 })).toBe(0);
    expect(FallbackUtility.of({ read: () => null, otherwise: {} })).toBeNull();
  });

  test('of answers otherwise when read throws, and runs read once', () => {
    let calls = 0;
    const fallback = { kept: [] };

    expect(
      FallbackUtility.of({
        read: () => {
          calls += 1;

          return throwing();
        },
        otherwise: fallback,
      }),
    ).toBe(fallback);
    expect(calls).toBe(1);
  });

  test('attempt runs the step and drops a throw', () => {
    const done: string[] = [];

    FallbackUtility.attempt({ run: () => done.push('ran') });

    expect(done).toEqual(['ran']);
    expect(() => FallbackUtility.attempt({ run: throwing })).not.toThrow();
  });

  test('parseJson reads JSON and answers undefined for text that is not JSON', () => {
    expect(FallbackUtility.parseJson({ text: '{"a":1}' })).toEqual({ a: 1 });
    expect(FallbackUtility.parseJson({ text: 'null' })).toBeNull();
    expect(FallbackUtility.parseJson({ text: '{"a":' })).toBeUndefined();
    expect(FallbackUtility.parseJson({ text: '' })).toBeUndefined();
  });
});
