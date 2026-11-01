import { describe, expect, test } from 'bun:test';
import { BunFormatter } from '@/common/format';

describe('BunFormatter.format', () => {
  test('lays JSON out the way bun fmt does: short arrays of scalars on one line', () => {
    const text = `${JSON.stringify({ aliases: ['k', 'j'], empty: [] }, null, 2)}\n`;

    expect(BunFormatter.format({ text, file: 'table.json' })).toBe(
      '{\n  "aliases": ["k", "j"],\n  "empty": []\n}\n',
    );
  });

  test('is a no-op on text that is already formatted', () => {
    const text = '{\n  "a": 1\n}\n';

    expect(BunFormatter.format({ text, file: 'table.json' })).toBe(text);
  });
});
