import { describe, expect, test } from 'bun:test';
import { VulcanError } from '../../index.ts';

describe('VulcanError.of', () => {
  test('is an Error named Error that keeps the message and holds no cause of its own', () => {
    const error = VulcanError.of({ message: 'boom' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VulcanError);
    expect(error.name).toBe('Error');
    expect(error.message).toBe('boom');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  test('keeps the cause it wraps', () => {
    const cause = new TypeError('inner');
    const error = VulcanError.of({ message: 'outer', cause });

    expect(error.cause).toBe(cause);
  });
});
