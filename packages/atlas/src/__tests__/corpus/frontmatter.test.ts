import { describe, expect, test } from 'bun:test';
import { parseFrontmatter } from '@/corpus/frontmatter';

describe('parseFrontmatter', () => {
  test('a page saved with CRLF line endings keeps its frontmatter', () => {
    const text = '---\r\ntitle: Kernel\r\ntype: Concept\r\n---\r\n\r\nThe kernel boots.\r\n';
    const { data, body } = parseFrontmatter({ text, path: 'kernel.md' });

    expect(data).toEqual({ title: 'Kernel', type: 'Concept' });
    expect(body).toBe('\r\nThe kernel boots.\r\n');
  });

  test('a page saved with LF line endings reads the same', () => {
    const text = '---\ntitle: Kernel\ntype: Concept\n---\n\nThe kernel boots.\n';
    const { data, body } = parseFrontmatter({ text, path: 'kernel.md' });

    expect(data).toEqual({ title: 'Kernel', type: 'Concept' });
    expect(body).toBe('\nThe kernel boots.\n');
  });
});
