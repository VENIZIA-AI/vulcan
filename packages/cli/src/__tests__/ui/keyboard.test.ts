import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { guardAgainstPipedLines, PipedInputRefusal } from '../../ui/keyboard.ts';

const never = (): Promise<string> => new Promise(() => {});

afterEach(() => {
  process.stdin.removeAllListeners('data');
});

describe('guardAgainstPipedLines', () => {
  test('a line feed while the menu is open rejects with the typed refusal, and prints the way out', async () => {
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const pending = guardAgainstPipedLines(never);

      process.stdin.emit('data', Buffer.from('my-product\n'));

      const result = await pending.catch((error: unknown) => error);
      expect(result).toBeInstanceOf(PipedInputRefusal);
      expect(String(stderr.mock.calls[0]?.[0])).toContain('reads key presses, not lines');
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  test('the caller finally blocks run: the refusal travels as an error, not as process.exit', async () => {
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cleaned: string[] = [];

    try {
      const flow = async (): Promise<string> => {
        try {
          const result = await guardAgainstPipedLines(never);
          return result;
        } finally {
          cleaned.push('scratch removed');
        }
      };
      const pending = flow();

      process.stdin.emit('data', Buffer.from('\n'));
      const result = await pending.catch((error: unknown) => error);
      expect(result).toBeInstanceOf(PipedInputRefusal);
      expect(cleaned).toEqual(['scratch removed']);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  test('key presses without a line feed pass, and the answer comes back', async () => {
    const pending = guardAgainstPipedLines(async () => 'picked');

    process.stdin.emit('data', Buffer.from('\r'));

    const result = await pending;
    expect(result).toBe('picked');
  });

  test('the listener is removed when the menu ends', async () => {
    const before = process.stdin.listenerCount('data');

    await guardAgainstPipedLines(async () => 'done');

    expect(process.stdin.listenerCount('data')).toBe(before);
  });
});
