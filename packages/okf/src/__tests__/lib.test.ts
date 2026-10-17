import { describe, expect, test } from 'bun:test';
import { extractLinks, parseFrontmatter } from '../lib.ts';

describe('extractLinks (OKF v0.2 §6.1)', () => {
  test('a bundle-absolute link, with or without an anchor', () => {
    expect(extractLinks({ text: '[a](/x/a.md) [b](/x/b.md#usage)', id: '/y/c' })).toEqual([
      '/x/a',
      '/x/b',
    ]);
  });

  test('relative links resolve against the linking concept', () => {
    expect(extractLinks({ text: '[a](./a.md) [b](../b.md) [c](c.md)', id: '/x/y/self' })).toEqual([
      '/x/y/a',
      '/x/b',
      '/x/y/c',
    ]);
  });

  test('external links, bare anchors and non-markdown targets are not edges', () => {
    expect(
      extractLinks({
        text: '[w](https://x.dev/a.md) [m](mailto:a@b.c) [h](#top) [i](/img.png)',
        id: '/a',
      }),
    ).toEqual([]);
  });

  test('links inside code are examples, not edges', () => {
    expect(extractLinks({ text: '`[a](/a.md)`\n```\n[b](/b.md)\n```', id: '/c' })).toEqual([]);
  });

  test('each target appears once', () => {
    expect(extractLinks({ text: '[a](/a.md) [again](/a.md#x)', id: '/c' })).toEqual(['/a']);
  });
});

describe('parseFrontmatter', () => {
  test('CRLF files parse like LF', () => {
    expect(parseFrontmatter({ text: '---\r\ntype: T\r\n---\r\nbody', file: 'a.md' })).toEqual({
      data: { type: 'T' },
      body: 'body',
    });
  });
});
