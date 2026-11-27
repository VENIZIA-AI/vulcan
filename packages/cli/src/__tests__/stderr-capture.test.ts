import { describe, expect, test } from 'bun:test';
import { CapturedStderr } from './stderr.helper.ts';

describe('CapturedStderr', () => {
  test('a line written in pieces is one line, and the callback of a write is called', async () => {
    const stderr = CapturedStderr.start({ processWrites: true });
    const bytes = new TextEncoder().encode('đã xong\n');
    let isDone = false;

    process.stderr.write('first ha');
    process.stderr.write('lf\nsecond ', () => {
      isDone = true;
    });
    // Cut inside the first letter, which is two bytes.
    process.stderr.write(bytes.slice(0, 1));
    process.stderr.write(bytes.slice(1));
    await Promise.resolve();

    stderr.claim({ parts: ['first half'] });
    stderr.claim({ parts: ['second đã xong'] });
    stderr.restore();
    expect(isDone).toBe(true);
  });

  test('a line left without its newline is still seen at the end', () => {
    const stderr = CapturedStderr.start({ processWrites: true });

    process.stderr.write('unfinished');

    expect(() => stderr.restore()).toThrow('unfinished');
  });
});
