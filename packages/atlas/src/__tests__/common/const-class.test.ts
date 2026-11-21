import { describe, expect, test } from 'bun:test';
import { ConstClass } from '../../common';
import type { TConstValue } from '../../common';

class Colors extends ConstClass {
  static readonly RED = 'red';
  static readonly BLUE = 'blue';
  static readonly DEFAULT = this.RED;
  static readonly LEVELS = [1, 2];
}

class Empty extends ConstClass {
  static readonly COUNT = 3;
}

describe('ConstClass', () => {
  test('values are the string statics of the subclass, once each, in declaration order', () => {
    expect(Colors.values()).toEqual(['red', 'blue']);
  });

  test('values are cached per subclass', () => {
    expect(Colors.values()).toBe(Colors.values());
  });

  test('a subclass with no string static throws, naming itself', () => {
    expect(() => Empty.values()).toThrow('Empty has no values');
  });

  test('isValid accepts a value and refuses anything else', () => {
    expect(Colors.isValid('red')).toBe(true);
    expect(Colors.isValid('green')).toBe(false);
    expect(Colors.isValid(1)).toBe(false);
    expect(Colors.isValid('Colors')).toBe(false);
  });

  test('TConstValue of a subclass is its literals, not the inherited statics', () => {
    const value: TConstValue<typeof Colors> = 'blue';
    // @ts-expect-error 'values' is an inherited static, not a value
    const bad: TConstValue<typeof Colors> = 'values';

    expect([value, bad]).toHaveLength(2);
  });
});
