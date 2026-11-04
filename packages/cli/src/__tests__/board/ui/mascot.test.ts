import { describe, expect, test } from 'bun:test';
import { BoardFace } from '../../../board/ui/components/face.tsx';

describe('BoardFace', () => {
  test('an agent has the same colour every time, and the palette has more than one', () => {
    const names = ['acme-forge', 'acme-api', 'acme-web', 'pnt-api-1', 'pnt-web-1', 'worker-9'];
    const colors = names.map((name) => BoardFace.colorOf({ name }));

    expect(names.map((name) => BoardFace.colorOf({ name }))).toEqual(colors);
    expect(new Set(colors).size).toBeGreaterThan(2);

    for (const color of colors) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test('the shape is the one the config names, else the default; an unknown one is the default', () => {
    expect(BoardFace.shapeOf({ name: 'a', shapes: { a: 'flame' } })).toBe('flame');
    expect(BoardFace.shapeOf({ name: 'b', shapes: { a: 'flame' } })).toBe('bun');
    expect(BoardFace.shapeOf({ name: 'a', shapes: { a: 'unicorn' } })).toBe('bun');
  });
});
